# AI Analysis Pipeline — Research Notes

## Question: What models/tools are best for keyframe detection in cycling video (side-view)?

---

## Stage 1 — Pose Estimation Models

### Tier 1 (proven in cycling apps, recommended for prototyping)

**Google MediaPipe Pose**
- 33 body keypoints, 3D world coordinates, Apache 2.0, no GPU required
- Works well from side-view video
- Used in multiple open-source bike fitting projects: `cycling-postural-analysis`, `NintAi`
- `cycling-postural-analysis` (Prevost-Guillaume) extracts pedaling cycles using MediaPipe + Monte Carlo thresholding — closest existing OSS impl to our use case
- Keyframe extraction: derive crank positions from knee/ankle angle peaks/troughs across frames

**ViTPose / easy_ViTPose**
- Vision Transformer-based, higher accuracy than MediaPipe (79.1 AP on COCO)
- Pipeline: YOLOv8 (person detection) → ViTPose (keypoints)
- Video support with SORT tracking between frames; ONNX/TensorRT ready
- Multiple model sizes (S/B/L/H)
- Entry point: https://github.com/aslanis/ViTPose

### Tier 2 (higher integration cost)

**MMPose** (OpenMMLab)
- Framework with dozens of models; RTMPose is current speed/accuracy sweet spot for real-time video
- `MMPoseInferencer` handles video natively with one API call
- Best if fine-tuning or custom skeleton definitions are needed

**NVIDIA GEM-X** (Apache 2.0, 2026)
- 77-joint full-body 3D pose from monocular video
- Handles dynamic cameras, outputs global motion trajectories
- Overkill unless full 3D reconstruction is required

### Avoid

| Model | Reason |
|---|---|
| OpenPose (CMU) | Sports use commercially restricted ($25k/year) |
| YOLO-NAS-Pose | Commercial restrictions unless agreed with Deci AI |

### Crank position detection strategy

Pose models don't detect the crank directly. Derivation options:
1. **Body pose only**: track ankle/knee angle over time → peaks/troughs map to ~TDC (12 o'clock) and BDC (6 o'clock)
2. **Hybrid**: pose estimation + small custom YOLO model trained to detect the crank arm tip
3. Reference: `cycling-postural-analysis` uses interpolation to normalize each pedal revolution

---

## Stage 2 — LLM-Based Keyframe Pre-Filtering (Two-Stage Pipeline)

### Approach rationale

Instead of running pose estimation on every frame, use a video-capable LLM as a semantic pre-filter to identify biomechanically interesting frames first. The LLM understands descriptions like "crank at 6 o'clock" or "maximum knee extension" without requiring domain-specific CV training.

**Architecture:**

```
Video clip (30–60s)
        │
        ▼
┌───────────────────┐
│  Gemini 2.5 Flash │  ← "Return timestamps of 12/3/6/9 o'clock
│  (semantic filter)│    crank positions and peak knee extension"
└───────────────────┘
        │
        ▼  timestamps: [1.2s, 3.8s, 5.1s, ...]
        │
        ▼
  Extract frames at timestamps (OpenCV)
        │
        ▼
┌────────────────────┐
│ MediaPipe / ViTPose│  ← runs on 4–8 frames, not full video
│ (pose estimation)  │
└────────────────────┘
        │
        ▼
  Joint angles, biomechanical report
```

### Video-capable LLMs evaluated

**Gemini 2.5 Pro / Flash** — **recommended**
- Native video input (File API, up to 20GB); model processes video frames directly
- Returns timestamps of key moments from a natural-language prompt
- Google Vertex AI has a dedicated "identify key moments in video" sample
- Cheapest and least pre-processing code required

**GPT-4o / GPT-4.1** (OpenAI)
- No native video — pre-extract frames, pass as base64 image batch in one request
- 1M token context handles ~1 min of video at 1 fps easily
- OpenAI cookbook documents this frame-extraction pattern
- GPT-4.1-mini is cheaper for the pre-filtering step

**Claude Opus 4.x** (Anthropic)
- Image-only API (same frame-extraction approach as GPT-4.1)
- No timestamp-native output; better suited for single-frame analysis

**F-16** (open-source, arxiv 2025 — not yet released)
- 7B model trained at 16 fps for high-frame-rate video
- Outperforms GPT-4o on sports analysis benchmarks (gymnastics, diving, basketball)
- Self-hostable, zero API cost after setup; watch for release

### Trade-offs

| Approach | Pro | Con |
|---|---|---|
| LLM pre-filter | No crank-specific CV model needed; semantic understanding | ~$0.001–0.005/clip API cost; ~0.5–1s timestamp precision |
| Pose on every frame | Higher temporal precision | Slower; more compute; no semantic understanding |
| **Hybrid (recommended)** | LLM picks approximate windows → pose finds exact frame | Two inference steps, slightly more code |

---

## Recommendation

- **Prototype**: MediaPipe Pose (free, no GPU, proven in cycling apps) + Gemini 2.5 Flash for semantic keyframe selection
- **Production accuracy**: ViTPose-L or RTMPose replacing MediaPipe once prototype validates the pipeline shape
- **Crank detection**: derive from knee/ankle angle tracking; only add custom YOLO crank detector if angle-based derivation proves insufficiently precise

Resolves open question **OQ-3** (which pose estimation tool/API to use) in favour of MediaPipe for MVP with ViTPose as upgrade path.

---

## Stage 3 — MediaPipe Integration Detail (`@mediapipe/tasks-vision`)

### Package

```bash
npm install @mediapipe/tasks-vision
```

JS/TS Tasks API — runs in the browser via WebAssembly. No Python runtime needed.

### Running mode: IMAGE (not VIDEO)

Since the pipeline runs MediaPipe on 4–8 semantically pre-selected frames (not a continuous stream), use `RunningMode.IMAGE` + `detect()`. VIDEO mode applies temporal smoothing across consecutive frames — counterproductive when frames are non-consecutive and independently selected.

### Setup

```typescript
import { PoseLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

const vision = await FilesetResolver.forVisionTasks(
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm"
);

const poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
  baseOptions: {
    modelAssetPath: "/models/pose_landmarker_heavy.task", // self-hosted
    delegate: "GPU",
  },
  runningMode: "IMAGE",
  numPoses: 1,
});
```

Model files (download once, serve statically):
- `pose_landmarker_lite.task` — fastest, lower accuracy
- `pose_landmarker_full.task` — balanced
- `pose_landmarker_heavy.task` — **recommended** for fitting accuracy

### Seeking video to a timestamp and extracting a frame

```typescript
async function detectAtTimestamp(
  videoEl: HTMLVideoElement,
  timestampSec: number
): Promise<PoseLandmarkerResult> {
  videoEl.currentTime = timestampSec;
  await new Promise(r => videoEl.addEventListener("seeked", r, { once: true }));

  const canvas = document.createElement("canvas");
  canvas.width = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;
  canvas.getContext("2d")!.drawImage(videoEl, 0, 0);
  const bitmap = await createImageBitmap(canvas);

  return poseLandmarker.detect(bitmap);
}
```

### Result shape and landmark indices

```typescript
// result.landmarks[0]      — 33 points, normalized [0,1] — good for display overlay
// result.worldLandmarks[0] — 33 points, meters, origin = hip midpoint — use for angle math

const wl = result.worldLandmarks[0];
// Key indices for bike fitting:
// 11 LEFT_SHOULDER   12 RIGHT_SHOULDER
// 13 LEFT_ELBOW      14 RIGHT_ELBOW
// 23 LEFT_HIP        24 RIGHT_HIP
// 25 LEFT_KNEE       26 RIGHT_KNEE
// 27 LEFT_ANKLE      28 RIGHT_ANKLE
```

### Angle calculation

```typescript
function jointAngle(
  a: {x:number,y:number,z:number},
  b: {x:number,y:number,z:number},
  c: {x:number,y:number,z:number}
): number {
  const ba = [a.x-b.x, a.y-b.y, a.z-b.z];
  const bc = [c.x-b.x, c.y-b.y, c.z-b.z];
  const dot = ba[0]*bc[0] + ba[1]*bc[1] + ba[2]*bc[2];
  const magBa = Math.hypot(...ba);
  const magBc = Math.hypot(...bc);
  return Math.acos(Math.max(-1, Math.min(1, dot / (magBa * magBc)))) * (180 / Math.PI);
}

const kneeAngle  = jointAngle(wl[23], wl[25], wl[27]); // hip–knee–ankle
const hipAngle   = jointAngle(wl[11], wl[23], wl[25]); // shoulder–hip–knee
const torsoAngle = jointAngle(wl[23], wl[11], wl[12]); // hip–shoulder–shoulder (back angle proxy)
```

Filter landmarks with `visibility < 0.5` before computing angles.

### Full browser-side pipeline

```
User uploads MP4
       │
       ▼
[browser] videoEl.currentTime seeks + canvas.drawImage → sampled frames → base64
       │  (or pass full video via Gemini File API from server)
       ▼
POST /api/analyze  →  [server] Gemini 2.5 Flash
       │               "return timestamps of BDC, TDC, peak knee extension"
       ▼
{ timestamps: [1.2, 3.8, 5.1, 7.4] }  returned to browser
       │
       ▼
[browser] seek videoEl to each timestamp → canvas → PoseLandmarker.detect()
       │   (4–8 frames only; WASM + GPU, ~50–200 ms total)
       ▼
worldLandmarks per frame → jointAngle() calculations
       │
       ▼
POST /api/sessions/:id/results  →  Supabase
```

Gemini call must go through the server (API key). MediaPipe runs entirely in the browser — no Python, no separate compute service, fits Cloudflare Workers stack cleanly.

### Seek precision caveat

`HTMLVideoElement.currentTime` seek precision is codec-dependent. For video with keyframes every 2–5s, the decoded frame may land ±0.5s from the requested timestamp. If Gemini identifies "BDC at 3.8s" and the seek lands at 3.4s, the knee won't be at full extension. Mitigation: after seeking, scan ±N frames (using `requestVideoFrameCallback` or repeated seeks at +33ms intervals) and pick the frame whose knee angle most closely matches the expected pose.

---

## Stage 4 — Cloudflare Containers as an Alternative Pose Estimation Backend

### Status

Cloudflare Containers went GA on **2026-04-13**. Available on all paid plans. No Kubernetes, no separate infra — deploy via `wrangler deploy` alongside the existing Worker.

### What this enables

Containers run any Docker image (`linux/amd64`) with full Linux environment, arbitrary Python, GPU-less CPU workloads, and access to the filesystem. The container is controlled by a Worker/Durable Object via HTTP; cold starts are 1–3 s depending on image size.

This means Python `mediapipe` (the full library, not the WASM port) + `opencv-python` can run **server-side on Cloudflare's network** — no browser dependency for pose estimation.

### Alternative pipeline: Worker → Container

```
User uploads MP4 → stored in R2
        │
        ▼
POST /api/analyze  →  Worker
        │
        ├─► Gemini 2.5 Flash  (timestamps: [1.2, 3.8, 5.1, 7.4])
        │
        └─► Cloudflare Container (Python)
              │  OpenCV reads video from R2 presigned URL
              │  cv2.VideoCapture.set(CAP_PROP_POS_MSEC, t*1000)
              │  → frame-accurate seek (no codec-keyframe rounding)
              │  mediapipe PoseLandmarker.detect(frame)
              └─► { landmarks, angles } per timestamp  →  Worker  →  Supabase
```

### Why this fixes the seek precision problem

Browser `currentTime` seeks to the nearest I-frame, which may be ±0.5 s off. OpenCV's `CAP_PROP_POS_MSEC` or `CAP_PROP_POS_FRAMES` seeks by decoded frame index — frame-accurate regardless of keyframe interval. This eliminates the scan-±N-frames mitigation entirely.

### Minimal container image (Dockerfile sketch)

```dockerfile
FROM python:3.12-slim
RUN pip install --no-cache-dir mediapipe opencv-python-headless fastapi uvicorn
COPY app.py .
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
```

`opencv-python-headless` (~50 MB) avoids GUI dependencies. `mediapipe` adds ~100 MB. Total image ~300–400 MB — cold start will be on the higher end (~3 s) until Cloudflare pre-warms the image globally.

### wrangler.jsonc integration

```jsonc
{
  "containers": [
    {
      "name": "POSE_CONTAINER",
      "image": "./pose-service/Dockerfile",
      "max_instances": 5
    }
  ],
  "durable_objects": {
    "bindings": [{ "name": "POSE_CONTAINER", "class_name": "PoseContainer" }]
  }
}
```

### Trade-off vs browser WASM approach

| | Browser WASM (`@mediapipe/tasks-vision`) | Cloudflare Container (Python) |
|---|---|---|
| **Seek accuracy** | ±0.5 s (codec-dependent) | Frame-accurate via OpenCV |
| **Compute cost** | Zero (runs on user device) | ~$0.01–0.05 per analysis (active CPU billing) |
| **Cold start** | Model load ~1–2 s (cached after first use) | Container cold start 1–3 s (amortised across session) |
| **MediaPipe version** | `tasks-vision` WASM (feature parity ~90%) | Full Python library, all task types |
| **Video source** | Browser `<video>` element | R2 presigned URL or streamed upload |
| **Ops complexity** | None (pure browser) | Dockerfile + wrangler container config |
| **Offline support** | Yes (after WASM/model cached) | No (requires network to Worker) |

### Recommendation update

- **MVP prototype**: Keep browser WASM (zero ops, zero cost). Apply the ±N-frame scan mitigation for seek precision.
- **Production / accuracy-critical path**: Switch pose estimation to a Cloudflare Container running Python MediaPipe + OpenCV. This eliminates the seek caveat cleanly and keeps everything within the Cloudflare platform — no external compute service needed.
- The container approach is a **drop-in upgrade**: same Gemini pre-filter for timestamps, same landmark indices and angle math — only the frame extraction + pose inference step moves from browser to server.

---

### MediaPipe Python API reference (container implementation)

> Source: [google/mediapipe](https://github.com/google/mediapipe/blob/master/docs/solutions/pose.md) — High reputation, 1 518 code snippets.

#### Installation

```bash
pip install mediapipe opencv-python-headless
```

#### Pose detection on a single frame (static image mode)

Use `static_image_mode=True` when processing individual frames extracted by OpenCV — no inter-frame tracking state needed.

```python
import cv2
import mediapipe as mp

mp_pose = mp.solutions.pose

with mp_pose.Pose(
    static_image_mode=True,
    model_complexity=2,          # 0=Lite, 1=Full, 2=Heavy
    enable_segmentation=True,
    min_detection_confidence=0.5,
) as pose:
    frame_bgr = cv2.imread("frame.png")
    results = pose.process(cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB))

    if results.pose_landmarks:
        lm = results.pose_landmarks.landmark
        h, w, _ = frame_bgr.shape
        print(f"Nose: ({lm[mp_pose.PoseLandmark.NOSE].x * w:.1f}, "
              f"{lm[mp_pose.PoseLandmark.NOSE].y * h:.1f})")
```

#### 33 body keypoints (`PoseLandmark` enum)

Each landmark exposes `x`, `y`, `z` (normalised 0–1, `z` is depth relative to hip) and `visibility` (0–1).

| Index | Name | Index | Name |
|---|---|---|---|
| 0 | NOSE | 17 | LEFT_PINKY |
| 11 | LEFT_SHOULDER | 12 | RIGHT_SHOULDER |
| 13 | LEFT_ELBOW | 14 | RIGHT_ELBOW |
| 15 | LEFT_WRIST | 16 | RIGHT_WRIST |
| 23 | LEFT_HIP | 24 | RIGHT_HIP |
| 25 | LEFT_KNEE | 26 | RIGHT_KNEE |
| 27 | LEFT_ANKLE | 28 | RIGHT_ANKLE |

Full list: indices 0–32 covering nose, eyes, ears, mouth, shoulders, elbows, wrists, fingers, hips, knees, ankles, and feet.

#### FastAPI endpoint sketch for the container

```python
# app.py  – runs inside the Cloudflare Container
import io
import cv2
import numpy as np
import mediapipe as mp
import httpx
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()
mp_pose = mp.solutions.pose

class AnalyzeRequest(BaseModel):
    presigned_url: str
    timestamps_ms: list[float]

@app.post("/analyze")
async def analyze(req: AnalyzeRequest):
    # Stream video from R2 presigned URL
    async with httpx.AsyncClient() as client:
        video_bytes = (await client.get(req.presigned_url)).content

    arr = np.frombuffer(video_bytes, np.uint8)
    cap = cv2.VideoCapture()
    cap.open(io.BytesIO(arr))           # OpenCV 4.9+ supports BytesIO

    results = []
    with mp_pose.Pose(static_image_mode=True, model_complexity=1,
                      min_detection_confidence=0.5) as pose:
        for t_ms in req.timestamps_ms:
            cap.set(cv2.CAP_PROP_POS_MSEC, t_ms)   # frame-accurate seek
            ok, frame = cap.read()
            if not ok:
                results.append({"timestamp_ms": t_ms, "landmarks": None})
                continue
            res = pose.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            landmarks = None
            if res.pose_landmarks:
                landmarks = [
                    {"x": lm.x, "y": lm.y, "z": lm.z, "visibility": lm.visibility}
                    for lm in res.pose_landmarks.landmark
                ]
            results.append({"timestamp_ms": t_ms, "landmarks": landmarks})

    cap.release()
    return {"results": results}
```

#### `model_complexity` trade-off

| Value | Name | Latency (CPU) | Notes |
|---|---|---|---|
| 0 | Lite | ~20 ms/frame | Good for MVP / low-latency |
| 1 | Full | ~80 ms/frame | Balanced — recommended default |
| 2 | Heavy | ~200 ms/frame | Highest accuracy, use for final analysis |

#### Key notes for the container context

- `static_image_mode=True` disables the tracking filter — correct for isolated frame extraction (no temporal smoothing artefacts).
- `enable_segmentation=True` adds a background mask but adds ~20–30 ms; skip unless needed.
- OpenCV's `CAP_PROP_POS_MSEC` seek is frame-accurate on H.264 files; `CAP_PROP_POS_FRAMES` requires knowing the exact frame index — use `POS_MSEC` when Gemini returns timestamps in seconds.
- `opencv-python-headless` must be used (not `opencv-python`) in a headless container — it omits GUI/display libraries.
