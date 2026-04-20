from __future__ import annotations

import os
import textwrap
import threading
import time
import uuid
from dataclasses import asdict, dataclass, field
from typing import Dict, Iterator, List, Optional

import cv2
import numpy as np
from flask import Flask, Response, jsonify, render_template, request, url_for

try:
    import yt_dlp
except ImportError:  # pragma: no cover - optional dependency at runtime
    yt_dlp = None


DEFAULT_SOURCE = "https://www.youtube.com/watch?v=80OT9PgWG-k"
STREAM_RETENTION_SECONDS = 15 * 60
DETECTION_INTERVAL = 3
MAX_FRAME_WIDTH = 960

app = Flask(__name__)


@dataclass
class StreamState:
    stream_id: str
    source_input: str
    source_label: str
    status: str = "queued"
    message: str = "Stream is waiting to start."
    last_person_count: int = 0
    frame_index: int = 0
    processed_frames: int = 0
    width: int = 0
    height: int = 0
    done: bool = False
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def to_public_dict(self) -> Dict[str, object]:
        data = asdict(self)
        data.pop("source_input", None)
        return data


stream_states: Dict[str, StreamState] = {}
stream_lock = threading.Lock()

hog = cv2.HOGDescriptor()
hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())


def prune_old_states() -> None:
    cutoff = time.time() - STREAM_RETENTION_SECONDS
    with stream_lock:
        stale_ids = [
            stream_id
            for stream_id, state in stream_states.items()
            if state.done and state.updated_at < cutoff
        ]
        for stream_id in stale_ids:
            stream_states.pop(stream_id, None)


def create_stream_state(source_input: str) -> StreamState:
    prune_old_states()
    stream_id = uuid.uuid4().hex
    state = StreamState(
        stream_id=stream_id,
        source_input=source_input,
        source_label=source_input,
        message="영상 연결을 준비하고 있습니다.",
    )
    with stream_lock:
        stream_states[stream_id] = state
    return state


def get_state(stream_id: str) -> Optional[StreamState]:
    with stream_lock:
        return stream_states.get(stream_id)


def update_state(stream_id: str, **changes: object) -> None:
    with stream_lock:
        state = stream_states.get(stream_id)
        if state is None:
            return
        for key, value in changes.items():
            setattr(state, key, value)
        state.updated_at = time.time()


def is_youtube_url(source: str) -> bool:
    lowered = source.lower()
    return "youtube.com/" in lowered or "youtu.be/" in lowered


def resolve_video_source(source: str) -> tuple[str, str]:
    cleaned = source.strip() or DEFAULT_SOURCE

    if is_youtube_url(cleaned):
        if yt_dlp is None:
            raise RuntimeError(
                "YouTube URL detection needs yt-dlp. Run 'pip install yt-dlp' first."
            )

        options = {
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "format": "best[height<=720]/best",
        }
        with yt_dlp.YoutubeDL(options) as ydl:
            info = ydl.extract_info(cleaned, download=False)

        if "entries" in info:
            info = next((entry for entry in info["entries"] if entry), None) or {}

        stream_url = info.get("url")
        title = info.get("title") or cleaned
        if not stream_url:
            raise RuntimeError("Unable to resolve a playable video stream from YouTube.")
        return stream_url, title

    return cleaned, cleaned


def resize_frame(frame: np.ndarray, max_width: int = MAX_FRAME_WIDTH) -> np.ndarray:
    height, width = frame.shape[:2]
    if width <= max_width:
        return frame
    scale = max_width / float(width)
    return cv2.resize(frame, (int(width * scale), int(height * scale)))


def detect_people(frame: np.ndarray) -> List[tuple[int, int, int, int, float]]:
    boxes, weights = hog.detectMultiScale(
        frame,
        winStride=(8, 8),
        padding=(8, 8),
        scale=1.05,
    )

    if len(boxes) == 0:
        return []

    if hasattr(weights, "flatten"):
        weights = weights.flatten().tolist()
    else:
        weights = list(weights)

    detections: List[tuple[int, int, int, int, float]] = []
    for (x, y, w, h), weight in zip(boxes, weights):
        confidence = float(weight)
        if confidence < 0.35:
            continue
        detections.append((int(x), int(y), int(w), int(h), confidence))
    return detections


def draw_overlay(
    frame: np.ndarray,
    detections: List[tuple[int, int, int, int, float]],
    source_label: str,
    person_count: int,
) -> np.ndarray:
    output = frame.copy()

    for x, y, w, h, confidence in detections:
        cv2.rectangle(output, (x, y), (x + w, y + h), (0, 210, 120), 2)
        label = f"person {confidence:.2f}"
        cv2.putText(
            output,
            label,
            (x, max(25, y - 8)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (255, 255, 255),
            2,
            cv2.LINE_AA,
        )

    cv2.rectangle(output, (0, 0), (output.shape[1], 72), (15, 20, 28), -1)
    cv2.putText(
        output,
        f"Detected people: {person_count}",
        (18, 30),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.9,
        (250, 250, 250),
        2,
        cv2.LINE_AA,
    )
    cv2.putText(
        output,
        source_label[:78],
        (18, 58),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.52,
        (176, 202, 214),
        1,
        cv2.LINE_AA,
    )
    return output


def build_error_frame(message: str) -> bytes:
    canvas = np.zeros((540, 960, 3), dtype=np.uint8)
    canvas[:] = (20, 24, 31)
    cv2.putText(
        canvas,
        "Stream error",
        (40, 70),
        cv2.FONT_HERSHEY_SIMPLEX,
        1.2,
        (255, 255, 255),
        2,
        cv2.LINE_AA,
    )

    wrapped = textwrap.wrap(message, width=54) or ["Unknown error"]
    y = 130
    for line in wrapped[:7]:
        cv2.putText(
            canvas,
            line,
            (40, y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.72,
            (235, 190, 120),
            2,
            cv2.LINE_AA,
        )
        y += 48

    ok, encoded = cv2.imencode(".jpg", canvas, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
    if not ok:
        raise RuntimeError("Failed to render error frame.")
    return encoded.tobytes()


def mjpeg_chunk(image_bytes: bytes) -> bytes:
    return (
        b"--frame\r\n"
        b"Content-Type: image/jpeg\r\n\r\n" + image_bytes + b"\r\n"
    )


def generate_stream(stream_id: str) -> Iterator[bytes]:
    state = get_state(stream_id)
    if state is None:
        yield mjpeg_chunk(build_error_frame("Unknown stream id."))
        return

    capture: Optional[cv2.VideoCapture] = None
    last_detections: List[tuple[int, int, int, int, float]] = []

    try:
        update_state(stream_id, status="connecting", message="영상 소스를 불러오는 중입니다.")
        resolved_source, source_label = resolve_video_source(state.source_input)
        update_state(stream_id, source_label=source_label)

        capture = cv2.VideoCapture(resolved_source)
        if not capture.isOpened():
            raise RuntimeError("OpenCV could not open the selected video stream.")

        update_state(stream_id, status="streaming", message="사람 감지를 시작했습니다.")

        frame_index = 0
        while True:
            ok, frame = capture.read()
            if not ok or frame is None:
                update_state(
                    stream_id,
                    status="finished",
                    message="영상 재생이 끝났거나 프레임을 더 이상 읽을 수 없습니다.",
                    done=True,
                )
                break

            frame = resize_frame(frame)
            frame_index += 1

            if frame_index % DETECTION_INTERVAL == 1:
                last_detections = detect_people(frame)

            person_count = len(last_detections)
            annotated = draw_overlay(frame, last_detections, source_label, person_count)

            update_state(
                stream_id,
                last_person_count=person_count,
                frame_index=frame_index,
                processed_frames=frame_index,
                width=int(annotated.shape[1]),
                height=int(annotated.shape[0]),
            )

            ok, encoded = cv2.imencode(
                ".jpg",
                annotated,
                [int(cv2.IMWRITE_JPEG_QUALITY), 85],
            )
            if not ok:
                continue

            yield mjpeg_chunk(encoded.tobytes())
    except Exception as exc:  # pragma: no cover - depends on runtime source availability
        update_state(
            stream_id,
            status="error",
            message=str(exc),
            done=True,
        )
        yield mjpeg_chunk(build_error_frame(str(exc)))
    finally:
        if capture is not None:
            capture.release()

        final_state = get_state(stream_id)
        if final_state and final_state.status not in {"error", "finished"}:
            update_state(
                stream_id,
                status="stopped",
                message="스트림 연결이 종료되었습니다.",
                done=True,
            )


@app.get("/")
def index() -> str:
    return render_template(
        "index.html",
        default_source=DEFAULT_SOURCE,
        youtube_support_ready=yt_dlp is not None,
    )


@app.post("/api/streams")
def create_stream() -> Response:
    payload = request.get_json(silent=True) or request.form or {}
    source = str(payload.get("source", "")).strip() or DEFAULT_SOURCE

    state = create_stream_state(source)
    return jsonify(
        {
            "stream_id": state.stream_id,
            "stream_url": url_for("video_feed", stream_id=state.stream_id),
            "status_url": url_for("stream_status", stream_id=state.stream_id),
        }
    )


@app.get("/api/streams/<stream_id>")
def stream_status(stream_id: str) -> Response:
    state = get_state(stream_id)
    if state is None:
        return jsonify({"error": "Stream not found."}), 404
    return jsonify(state.to_public_dict())


@app.get("/video-feed/<stream_id>")
def video_feed(stream_id: str) -> Response:
    return Response(
        generate_stream(stream_id),
        mimetype="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
    )


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=True)
