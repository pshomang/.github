import os
import sys
import json
import math
import time
import wave
import logging
import argparse
from dataclasses import dataclass
from typing import List, Optional, Callable, TypeVar

import numpy as np
import requests
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from openai import OpenAI
import replicate

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s | %(levelname)-7s | %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("pipeline")

# ---------------------------------------------------------------------------
# moviepy compatibility shim (works on moviepy 1.x and 2.x)
# ---------------------------------------------------------------------------
try:  # moviepy 2.x
    from moviepy import (
        VideoFileClip,
        AudioFileClip,
        ImageClip,
        CompositeAudioClip,
        concatenate_videoclips,
    )
    _MOVIEPY_V2 = True
except ImportError:  # moviepy 1.x
    from moviepy.editor import (  # type: ignore
        VideoFileClip,
        AudioFileClip,
        ImageClip,
        CompositeAudioClip,
        concatenate_videoclips,
    )
    _MOVIEPY_V2 = False


def _set_audio(clip, audio):
    return clip.with_audio(audio) if _MOVIEPY_V2 else clip.set_audio(audio)


def _set_duration(clip, duration):
    return clip.with_duration(duration) if _MOVIEPY_V2 else clip.set_duration(duration)


def _subclip(clip, start, end):
    if hasattr(clip, "subclipped"):  # moviepy 2.x
        return clip.subclipped(start, end)
    return clip.subclip(start, end)  # moviepy 1.x


def _loop_to(clip, duration):
    """Loop a clip until it reaches `duration`, version-agnostically."""
    if _MOVIEPY_V2:
        from moviepy.video.fx import Loop
        return clip.with_effects([Loop(duration=duration)])
    import moviepy.video.fx.all as vfx  # type: ignore
    return clip.fx(vfx.loop, duration=duration)


def _scale_volume(clip, factor):
    if _MOVIEPY_V2:
        from moviepy.audio.fx import MultiplyVolume
        return clip.with_effects([MultiplyVolume(factor)])
    return clip.volumex(factor)  # moviepy 1.x


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
@dataclass
class Config:
    chapter_file: str = "chapter.txt"
    output_dir: str = "output"
    script_model: str = "gpt-4o"
    tts_model: str = "tts-1"
    tts_voice: str = "onyx"  # deep, serious documentary voice
    video_model: str = "minimax/video-01"
    fps: int = 30
    drone_volume: float = 0.15  # background A-minor drone level
    add_background_drone: bool = True
    add_end_card: bool = True
    final_name: str = "The_Power_Chronicles_Chapter_One.mp4"
    retries: int = 4
    retry_base_delay: float = 2.0

    @property
    def assets_dir(self) -> str:
        return os.path.join(self.output_dir, "assets")

    @property
    def script_path(self) -> str:
        return os.path.join(self.output_dir, "script.json")

    @property
    def final_path(self) -> str:
        return os.path.join(self.output_dir, self.final_name)


# ---------------------------------------------------------------------------
# Retry helper
# ---------------------------------------------------------------------------
T = TypeVar("T")


def with_retries(
    fn: Callable[[], T],
    *,
    what: str,
    retries: int = 4,
    base_delay: float = 2.0,
) -> T:
    """Run `fn`, retrying on exception with exponential backoff (2s, 4s, 8s...)."""
    last_exc: Optional[Exception] = None
    for attempt in range(1, retries + 1):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001 - we want to retry on anything transient
            last_exc = exc
            if attempt == retries:
                break
            delay = base_delay * (2 ** (attempt - 1))
            log.warning(
                "%s failed (attempt %d/%d): %s. Retrying in %.0fs...",
                what, attempt, retries, exc, delay,
            )
            time.sleep(delay)
    assert last_exc is not None
    raise last_exc


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------
class Scene(BaseModel):
    id: int
    narration: str = Field(
        default="",
        description="The text to be spoken by the narrator. Leave empty if no narration for this scene.",
    )
    visual_prompt: str = Field(
        description=(
            "A highly detailed text-to-video prompt for the AI video generator. "
            "Describe the visuals, lighting, camera movement, and mood. "
            "Avoid people and Nazi symbols as per the requirements."
        )
    )


class Script(BaseModel):
    scenes: List[Scene]


# ---------------------------------------------------------------------------
# Pipeline steps
# ---------------------------------------------------------------------------
def generate_script(client: OpenAI, cfg: Config, chapter_text: str) -> Script:
    """Uses OpenAI to break the chapter text into a cinematic script."""
    log.info("Generating cinematic script with OpenAI (%s)...", cfg.script_model)

    system_prompt = """
    You are an expert cinematic director and prompt engineer.
    Convert the provided chapter text into a detailed shot-by-shot script.

    Rules:
    1. Break the story down into distinct cinematic scenes.
    2. Provide 'narration' (the exact text to be spoken, faithful to the text's voice).
    3. Provide 'visual_prompt' (a detailed prompt for an AI video generator).
    4. Guardrails: No depiction of Hitler and no Nazi symbols. Rely on typography,
       symbolic motifs (empty gilt frames, verdict card, unbuilt dome, single candle,
       embers), and an archival/sepia film look with grain, vignette, and letterbox bars.
    """

    def _call() -> Script:
        completion = client.beta.chat.completions.parse(
            model=cfg.script_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Chapter Text:\n{chapter_text}"},
            ],
            response_format=Script,
        )
        parsed = completion.choices[0].message.parsed
        if parsed is None:
            raise RuntimeError("OpenAI returned no parsed script.")
        return parsed

    script = with_retries(
        _call, what="Script generation",
        retries=cfg.retries, base_delay=cfg.retry_base_delay,
    )

    with open(cfg.script_path, "w") as f:
        json.dump(script.model_dump(), f, indent=4)

    log.info("Script generated (%d scenes) and saved to %s",
             len(script.scenes), cfg.script_path)
    return script


def generate_audio(client: OpenAI, cfg: Config, script: Script) -> None:
    """Generates TTS audio for each scene using OpenAI."""
    log.info("Generating audio for scenes...")
    for scene in script.scenes:
        if not scene.narration.strip():
            continue

        audio_path = os.path.join(cfg.assets_dir, f"scene_{scene.id}.mp3")
        if os.path.exists(audio_path):
            log.info("Audio for scene %d already exists. Skipping.", scene.id)
            continue

        log.info("Generating audio for scene %d...", scene.id)

        def _call() -> None:
            # Modern streaming-response API (replaces deprecated stream_to_file).
            with client.audio.speech.with_streaming_response.create(
                model=cfg.tts_model,
                voice=cfg.tts_voice,
                input=scene.narration,
            ) as response:
                response.stream_to_file(audio_path)

        with_retries(
            _call, what=f"Audio (scene {scene.id})",
            retries=cfg.retries, base_delay=cfg.retry_base_delay,
        )


def _extract_video_bytes(output) -> bytes:
    """Normalize Replicate output (FileOutput / list / URL string) into bytes."""
    # Newer replicate clients return FileOutput objects with .read()/.url
    if hasattr(output, "read"):
        return output.read()
    if isinstance(output, (list, tuple)) and output:
        return _extract_video_bytes(output[0])
    if hasattr(output, "url"):
        output = output.url
    if isinstance(output, str):
        resp = requests.get(output, timeout=120)
        resp.raise_for_status()
        return resp.content
    raise TypeError(f"Unexpected Replicate output type: {type(output)!r}")


def generate_video(cfg: Config, script: Script) -> None:
    """Generates video clips for each scene using Replicate."""
    log.info("Generating video clips with Replicate (%s)...", cfg.video_model)

    for scene in script.scenes:
        video_path = os.path.join(cfg.assets_dir, f"scene_{scene.id}.mp4")
        if os.path.exists(video_path) and os.path.getsize(video_path) > 0:
            log.info("Video for scene %d already exists. Skipping.", scene.id)
            continue

        log.info("Generating video for scene %d (this may take a while)...", scene.id)
        full_prompt = (
            f"{scene.visual_prompt}. Archival 1900s sepia film look, heavy film grain, "
            "vignette, letterbox bars. Somber documentary style. No people. No symbols."
        )

        def _call() -> None:
            output = replicate.run(cfg.video_model, input={"prompt": full_prompt})
            data = _extract_video_bytes(output)
            if not data:
                raise RuntimeError("Downloaded video was empty.")
            with open(video_path, "wb") as f:
                f.write(data)
            log.info("Saved video for scene %d (%d KB)", scene.id, len(data) // 1024)

        try:
            with_retries(
                _call, what=f"Video (scene {scene.id})",
                retries=cfg.retries, base_delay=cfg.retry_base_delay,
            )
        except Exception as exc:  # noqa: BLE001
            log.error("Failed to generate video for scene %d: %s", scene.id, exc)
            # Clean up any partial/empty file so assembly skips it cleanly.
            if os.path.exists(video_path) and os.path.getsize(video_path) == 0:
                os.remove(video_path)


# ---------------------------------------------------------------------------
# Background drone + end card (previously only described in comments)
# ---------------------------------------------------------------------------
def generate_drone(path: str, duration: float, sample_rate: int = 44100) -> str:
    """Synthesize a low, somber A-minor drone (A2 + C3 + E3) with fade in/out."""
    log.info("Synthesizing A-minor background drone (%.1fs)...", duration)
    freqs = [110.00, 130.81, 164.81]  # A2, C3, E3
    n = max(1, int(duration * sample_rate))
    t = np.linspace(0.0, duration, n, endpoint=False)

    tone = sum(np.sin(2 * math.pi * f * t) for f in freqs) / len(freqs)
    # Add a slow tremolo so the drone breathes rather than sits flat.
    tone *= 0.85 + 0.15 * np.sin(2 * math.pi * 0.1 * t)

    fade = min(2.0, duration / 4.0)  # seconds
    env = np.clip(t / fade, 0.0, 1.0) * np.clip((duration - t) / fade, 0.0, 1.0)
    tone *= env * 0.3  # headroom

    pcm = np.int16(np.clip(tone, -1.0, 1.0) * 32767)
    with wave.open(path, "w") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm.tobytes())
    return path


def make_end_card(path: str, size=(1280, 720)) -> str:
    """Render the closing credit card to a PNG using Pillow (no ImageMagick needed)."""
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGB", size, (8, 7, 6))
    draw = ImageDraw.Draw(img)

    def _font(sz: int):
        for name in ("DejaVuSerif.ttf", "DejaVuSans.ttf"):
            try:
                return ImageFont.truetype(name, sz)
            except OSError:
                continue
        return ImageFont.load_default()

    lines = [
        ("Pitso Adam Shomang", _font(48), (214, 199, 168)),
        ("Scribe to the Revelations of the Sun", _font(28), (150, 138, 116)),
    ]
    total_h = sum((draw.textbbox((0, 0), txt, font=f)[3]) + 24 for txt, f, _ in lines)
    y = (size[1] - total_h) // 2
    for txt, font, color in lines:
        bbox = draw.textbbox((0, 0), txt, font=font)
        w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
        draw.text(((size[0] - w) // 2, y), txt, font=font, fill=color)
        y += h + 24

    img.save(path)
    return path


def assemble_video(cfg: Config, script: Script) -> None:
    """Assemble the final video from per-scene clips, narration, drone, and end card."""
    log.info("Assembling the final video...")
    clips = []

    for scene in script.scenes:
        video_path = os.path.join(cfg.assets_dir, f"scene_{scene.id}.mp4")
        audio_path = os.path.join(cfg.assets_dir, f"scene_{scene.id}.mp3")

        if not (os.path.exists(video_path) and os.path.getsize(video_path) > 0):
            log.warning("Video for scene %d is missing. Skipping in assembly.", scene.id)
            continue

        try:
            video_clip = VideoFileClip(video_path)

            if os.path.exists(audio_path):
                audio_clip = AudioFileClip(audio_path)
                if audio_clip.duration > video_clip.duration:
                    video_clip = _loop_to(video_clip, audio_clip.duration)
                else:
                    video_clip = _subclip(video_clip, 0, audio_clip.duration)
                video_clip = _set_audio(video_clip, audio_clip)

            clips.append(video_clip)
        except Exception as exc:  # noqa: BLE001
            log.error("Failed to process scene %d for assembly: %s", scene.id, exc)

    if not clips:
        log.error("No valid clips to assemble. Exiting.")
        return

    # End card.
    if cfg.add_end_card and clips:
        try:
            end_png = os.path.join(cfg.assets_dir, "end_card.png")
            make_end_card(end_png, size=clips[0].size)
            end_clip = _set_duration(ImageClip(end_png), 4.0)
            clips.append(end_clip)
        except Exception as exc:  # noqa: BLE001
            log.warning("Could not build end card, continuing without it: %s", exc)

    log.info("Concatenating %d clips...", len(clips))
    final_video = concatenate_videoclips(clips, method="compose")

    # Background A-minor drone mixed under the narration.
    if cfg.add_background_drone:
        try:
            drone_path = os.path.join(cfg.assets_dir, "drone.wav")
            generate_drone(drone_path, final_video.duration)
            drone = _scale_volume(AudioFileClip(drone_path), cfg.drone_volume)
            drone = _set_duration(drone, final_video.duration)
            if final_video.audio is not None:
                mixed = CompositeAudioClip([final_video.audio, drone])
            else:
                mixed = drone
            final_video = _set_audio(final_video, mixed)
        except Exception as exc:  # noqa: BLE001
            log.warning("Could not add background drone, continuing without it: %s", exc)

    log.info("Writing final video to %s...", cfg.final_path)
    final_video.write_videofile(
        cfg.final_path,
        fps=cfg.fps,
        codec="libx264",
        audio_codec="aac",
    )
    log.info("Assembly complete! Your video is ready: %s", cfg.final_path)


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------
def load_script(cfg: Config) -> Optional[Script]:
    if os.path.exists(cfg.script_path):
        with open(cfg.script_path, "r") as f:
            return Script.model_validate(json.load(f))
    return None


SAMPLE_CHAPTER = """
Title — The Power Chronicles · Chapter One.
The premise — "Time has kept meticulous records… a man who decided the world owed him a destiny he never earned."
I. The Examination Room — Vienna, 1907; the empty-faces motif; the verdict "Few heads. Test drawing insufficient."; the examiner "diagnosing the twentieth century."
II. Owed a Destiny — rejection reframed as sabotage; "In that hour it began."
III. He Found His Stage — the medium he was gifted at: facades and spectacle; "What he could not do on paper, he would do on the world" (unbuilt-dome motif).
IV. What It Cost — handled with restraint: 70–85 million dead; six million Jews murdered by design; "The dome was never built. The camps were."
Dr. Eduard Bloch — the single mercy (candle motif).
V. The Scribe's Reflection — "The men most dangerous… are the ones who need to be seen." / "The work survives, even though every canvas burned."
End card — Pitso Adam Shomang · Scribe to the Revelations of the Sun.
""".strip()


def parse_args(argv: Optional[List[str]] = None) -> Config:
    cfg = Config()
    p = argparse.ArgumentParser(description="AI cinematic video generation pipeline.")
    p.add_argument("--chapter-file", default=cfg.chapter_file)
    p.add_argument("--output-dir", default=cfg.output_dir)
    p.add_argument("--video-model", default=cfg.video_model)
    p.add_argument("--fps", type=int, default=cfg.fps)
    p.add_argument("--no-drone", action="store_true", help="Disable background drone.")
    p.add_argument("--no-end-card", action="store_true", help="Disable end card.")
    p.add_argument("--skip-video", action="store_true",
                   help="Skip video generation (assemble from existing assets).")
    args = p.parse_args(argv)

    cfg.chapter_file = args.chapter_file
    cfg.output_dir = args.output_dir
    cfg.video_model = args.video_model
    cfg.fps = args.fps
    cfg.add_background_drone = not args.no_drone
    cfg.add_end_card = not args.no_end_card
    cfg._skip_video = args.skip_video  # type: ignore[attr-defined]
    return cfg


def main(argv: Optional[List[str]] = None) -> int:
    load_dotenv()
    cfg = parse_args(argv)

    if not os.getenv("OPENAI_API_KEY"):
        log.error("OPENAI_API_KEY is not set. Add it to your environment or .env file.")
        return 1
    if not os.getenv("REPLICATE_API_TOKEN") and not getattr(cfg, "_skip_video", False):
        log.error("REPLICATE_API_TOKEN is not set. Required for video generation.")
        return 1

    os.makedirs(cfg.assets_dir, exist_ok=True)
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

    # Ensure a chapter exists.
    if not os.path.exists(cfg.chapter_file):
        log.info("%s not found. Creating a sample one.", cfg.chapter_file)
        with open(cfg.chapter_file, "w") as f:
            f.write(SAMPLE_CHAPTER)

    with open(cfg.chapter_file, "r") as f:
        chapter_text = f.read()

    # Step 1: script
    script = load_script(cfg) or generate_script(client, cfg, chapter_text)

    # Step 2: audio
    generate_audio(client, cfg, script)

    # Step 3: video
    if getattr(cfg, "_skip_video", False):
        log.info("Skipping video generation (--skip-video).")
    else:
        generate_video(cfg, script)

    # Step 4: assemble
    assemble_video(cfg, script)

    log.info("All tasks complete!")
    return 0


if __name__ == "__main__":
    sys.exit(main())
