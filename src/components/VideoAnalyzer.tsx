import { useEffect, useRef, useState } from "react";
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { BodyAngle, Recommendation } from "@/types";
import { cn } from "@/lib/utils";

type AnalysisStep =
  | "starting"
  | "loading-model"
  | "extracting-frames"
  | "identifying-frames"
  | "measuring-angles"
  | "generating-recs"
  | "submitting";

interface Props {
  sessionId: string;
  file: File;
  onComplete: (sessionId: string) => void;
  onError: (message: string) => void;
}

const MEDIAPIPE_VERSION = "0.10.35";

const ANGLE_REFS = {
  KNEE_BDC: { min: 137, max: 147, unit: "degrees", name: "Knee angle at BDC" },
  KNEE_TDC: { min: 65, max: 75, unit: "degrees", name: "Knee angle at TDC" },
  HIP: { min: 55, max: 65, unit: "degrees", name: "Hip angle at TDC" },
  TORSO: { min: 45, max: 55, unit: "degrees", name: "Torso angle" },
  ELBOW: { min: 150, max: 160, unit: "degrees", name: "Elbow angle" },
} as const;

const STEPS: { id: AnalysisStep; label: string }[] = [
  { id: "starting", label: "Starting session" },
  { id: "loading-model", label: "Loading pose model" },
  { id: "extracting-frames", label: "Preparing video" },
  { id: "identifying-frames", label: "Identifying key frames" },
  { id: "measuring-angles", label: "Measuring joint angles" },
  { id: "generating-recs", label: "Generating recommendations" },
  { id: "submitting", label: "Saving results" },
];

interface PoseLandmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

function jointAngle(a: PoseLandmark, b: PoseLandmark, c: PoseLandmark): number {
  const ba = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  const bc = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
  const dot = ba.x * bc.x + ba.y * bc.y + ba.z * bc.z;
  const mag = (v: { x: number; y: number; z: number }) => Math.sqrt(v.x ** 2 + v.y ** 2 + v.z ** 2);
  return Math.acos(Math.max(-1, Math.min(1, dot / (mag(ba) * mag(bc))))) * (180 / Math.PI);
}

// Torso angle: angle of hip→shoulder vector from horizontal (Y increases downward in world coords)
function computeTorsoAngle(wl: PoseLandmark[]): number {
  return Math.abs(Math.atan2(wl[11].y - wl[23].y, wl[11].x - wl[23].x) * (180 / Math.PI));
}

function visible(lm: PoseLandmark | undefined): boolean {
  return (lm?.visibility ?? 0) >= 0.5;
}

function seekTo(videoEl: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const onSeeked = () => {
      videoEl.removeEventListener("seeked", onSeeked);
      resolve();
    };
    videoEl.addEventListener("seeked", onSeeked);
    videoEl.currentTime = Math.max(0, t);
  });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve((reader.result as string).split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadVideoElement(file: File): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.onloadeddata = () => {
      resolve(video);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load video for pose detection"));
    };
    video.src = url;
  });
}

async function detectPoseAt(
  videoEl: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  poseLandmarker: PoseLandmarker,
  t: number,
): Promise<PoseLandmark[] | null> {
  await seekTo(videoEl, t);
  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
  const bitmap = await createImageBitmap(canvas);
  const result = poseLandmarker.detect(bitmap);
  bitmap.close();
  // worldLandmarks is typed as non-nullable but may be empty when no pose is found
  return result.worldLandmarks.length > 0 ? result.worldLandmarks[0] : null;
}

export default function VideoAnalyzer({ sessionId, file, onComplete, onError }: Props) {
  const [currentStep, setCurrentStep] = useState<AnalysisStep>("starting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const hasRunRef = useRef(false);

  async function postError(step: string, detail: string): Promise<void> {
    const message = `${step}: ${detail}`;
    try {
      await fetch(`/api/sessions/${sessionId}/results`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: true, error_message: message }),
      });
    } catch {
      // best-effort; don't throw from error path
    }
    setErrorMessage(message);
    onError(message);
  }

  async function runPipeline(): Promise<void> {
    // Step 1: Start session — must be first so /results error path can always run
    setCurrentStep("starting");
    try {
      const res = await fetch(`/api/sessions/${sessionId}/start`, { method: "POST" });
      if (!res.ok && res.status !== 409) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      await postError("starting", err instanceof Error ? err.message : "Failed to start session");
      return;
    }

    // Step 2: Initialise MediaPipe PoseLandmarker (GPU with CPU fallback)
    setCurrentStep("loading-model");
    let poseLandmarker: PoseLandmarker;
    const wasmUrl = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
    const modelUrl =
      "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task";

    try {
      const vision = await FilesetResolver.forVisionTasks(wasmUrl);
      try {
        poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: modelUrl, delegate: "GPU" },
          runningMode: "IMAGE",
          numPoses: 1,
        });
      } catch {
        poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: modelUrl, delegate: "CPU" },
          runningMode: "IMAGE",
          numPoses: 1,
        });
      }
    } catch (err) {
      await postError("loading-model", err instanceof Error ? err.message : "Failed to initialize pose model");
      return;
    }

    // Step 3: Read video as base64 + load video element for frame seeking
    setCurrentStep("extracting-frames");
    let videoBase64: string;
    let videoEl: HTMLVideoElement;
    let canvas: HTMLCanvasElement;
    let ctx: CanvasRenderingContext2D;

    try {
      [videoBase64, videoEl] = await Promise.all([fileToBase64(file), loadVideoElement(file)]);
      canvas = document.createElement("canvas");
      canvas.width = videoEl.videoWidth || 640;
      canvas.height = videoEl.videoHeight || 480;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas context not available");
      ctx = context;
    } catch (err) {
      poseLandmarker.close();
      await postError("extracting-frames", err instanceof Error ? err.message : "Failed to read video");
      return;
    }

    // Step 4: Identify BDC/TDC timestamps via vision LLM
    setCurrentStep("identifying-frames");
    let timestamps: { t: number; type: "BDC" | "TDC" }[];

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ video: videoBase64 }),
      });
      if (!res.ok) throw new Error(`Server returned HTTP ${res.status}`);
      const data = (await res.json()) as { timestamps?: { t: number; type: "BDC" | "TDC" }[] };
      timestamps = data.timestamps ?? [];
      if (!timestamps.length) {
        throw new Error("No keyframes detected — try a clearer side-view video with the full body visible");
      }
    } catch (err) {
      URL.revokeObjectURL(videoEl.src);
      poseLandmarker.close();
      await postError("identifying-frames", err instanceof Error ? err.message : "Failed to identify keyframes");
      return;
    }

    // Step 5: ±2-frame scan around each timestamp, pick best pose, compute angles
    setCurrentStep("measuring-angles");
    const bodyAngles: BodyAngle[] = [];
    const scanOffsets = [-0.066, -0.033, 0, 0.033, 0.066];

    try {
      let bdcLandmarks: PoseLandmark[] | null = null;
      let tdcLandmarks: PoseLandmark[] | null = null;

      for (const { t, type } of timestamps) {
        if (type === "BDC" && bdcLandmarks) continue;
        if (type === "TDC" && tdcLandmarks) continue;

        let bestLandmarks: PoseLandmark[] | null = null;
        // BDC: most extended leg = highest knee angle; TDC: deepest flex = lowest knee angle
        let bestKneeAngle = type === "BDC" ? -Infinity : Infinity;

        for (const offset of scanOffsets) {
          const wl = await detectPoseAt(videoEl, canvas, ctx, poseLandmarker, t + offset);
          if (!wl || !visible(wl[23]) || !visible(wl[25]) || !visible(wl[27])) continue;

          const ka = jointAngle(wl[23], wl[25], wl[27]);
          if (type === "BDC" && ka > bestKneeAngle) {
            bestKneeAngle = ka;
            bestLandmarks = wl;
          } else if (type === "TDC" && ka < bestKneeAngle) {
            bestKneeAngle = ka;
            bestLandmarks = wl;
          }
        }

        if (type === "BDC") bdcLandmarks = bestLandmarks;
        else tdcLandmarks = bestLandmarks;
      }

      // Angles from BDC frame: knee-BDC, torso, elbow
      if (bdcLandmarks) {
        const wl = bdcLandmarks;
        if (visible(wl[23]) && visible(wl[25]) && visible(wl[27])) {
          bodyAngles.push({
            name: ANGLE_REFS.KNEE_BDC.name,
            value: jointAngle(wl[23], wl[25], wl[27]),
            reference_min: ANGLE_REFS.KNEE_BDC.min,
            reference_max: ANGLE_REFS.KNEE_BDC.max,
            unit: ANGLE_REFS.KNEE_BDC.unit,
          });
        }
        if (visible(wl[11]) && visible(wl[23])) {
          bodyAngles.push({
            name: ANGLE_REFS.TORSO.name,
            value: computeTorsoAngle(wl),
            reference_min: ANGLE_REFS.TORSO.min,
            reference_max: ANGLE_REFS.TORSO.max,
            unit: ANGLE_REFS.TORSO.unit,
          });
        }
        if (visible(wl[11]) && visible(wl[13]) && visible(wl[15])) {
          bodyAngles.push({
            name: ANGLE_REFS.ELBOW.name,
            value: jointAngle(wl[11], wl[13], wl[15]),
            reference_min: ANGLE_REFS.ELBOW.min,
            reference_max: ANGLE_REFS.ELBOW.max,
            unit: ANGLE_REFS.ELBOW.unit,
          });
        }
      }

      // Angles from TDC frame: knee-TDC, hip
      if (tdcLandmarks) {
        const wl = tdcLandmarks;
        if (visible(wl[23]) && visible(wl[25]) && visible(wl[27])) {
          bodyAngles.push({
            name: ANGLE_REFS.KNEE_TDC.name,
            value: jointAngle(wl[23], wl[25], wl[27]),
            reference_min: ANGLE_REFS.KNEE_TDC.min,
            reference_max: ANGLE_REFS.KNEE_TDC.max,
            unit: ANGLE_REFS.KNEE_TDC.unit,
          });
        }
        if (visible(wl[11]) && visible(wl[23]) && visible(wl[25])) {
          bodyAngles.push({
            name: ANGLE_REFS.HIP.name,
            value: jointAngle(wl[11], wl[23], wl[25]),
            reference_min: ANGLE_REFS.HIP.min,
            reference_max: ANGLE_REFS.HIP.max,
            unit: ANGLE_REFS.HIP.unit,
          });
        }
      }

      if (bodyAngles.length < 2) {
        throw new Error("Pose not detected clearly — try a clearer side-view video with the full body visible");
      }
    } catch (err) {
      URL.revokeObjectURL(videoEl.src);
      poseLandmarker.close();
      await postError("measuring-angles", err instanceof Error ? err.message : "Failed to measure joint angles");
      return;
    }

    URL.revokeObjectURL(videoEl.src);
    poseLandmarker.close();

    // Step 6: Generate fitting recommendations
    setCurrentStep("generating-recs");
    let recommendations: Recommendation[];
    let rawLlmResponse: string;

    try {
      const res = await fetch(`/api/sessions/${sessionId}/recommend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body_angles: bodyAngles }),
      });
      if (!res.ok) throw new Error(`Server returned HTTP ${res.status}`);
      const data = (await res.json()) as { recommendations: Recommendation[]; raw_llm_response: string };
      recommendations = data.recommendations;
      rawLlmResponse = data.raw_llm_response;
    } catch (err) {
      await postError("generating-recs", err instanceof Error ? err.message : "Failed to generate recommendations");
      return;
    }

    // Step 7: Submit complete results
    setCurrentStep("submitting");
    try {
      const res = await fetch(`/api/sessions/${sessionId}/results`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recommendations, body_angles: bodyAngles, raw_llm_response: rawLlmResponse }),
      });
      if (!res.ok) throw new Error(`Server returned HTTP ${res.status}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save results";
      setErrorMessage(msg);
      onError(msg);
      return;
    }

    onComplete(sessionId);
  }

  useEffect(() => {
    if (hasRunRef.current) return;
    hasRunRef.current = true;
    void runPipeline();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (errorMessage) {
    return (
      <div className="flex flex-col items-center gap-4 p-8">
        <h2 className="text-xl font-semibold">Analysis failed</h2>
        <p className="text-destructive max-w-sm text-center text-sm">{errorMessage}</p>
      </div>
    );
  }

  const currentIdx = STEPS.findIndex((s) => s.id === currentStep);

  return (
    <div className="flex flex-col items-center gap-6 p-8">
      <h2 className="text-xl font-semibold">Analysing your video</h2>
      <ol className="flex w-full max-w-sm flex-col gap-3">
        {STEPS.map((step, i) => {
          const done = i < currentIdx;
          const active = i === currentIdx;
          return (
            <li
              key={step.id}
              className={cn("flex items-center gap-3 text-sm", !done && !active && "text-muted-foreground/50")}
            >
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                  done && "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
                  active && "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
                  !done && !active && "bg-muted text-muted-foreground/50",
                )}
              >
                {done ? "✓" : i + 1}
              </span>
              <span className={cn(active && "font-medium")}>{step.label}</span>
              {active && <span className="text-muted-foreground ml-auto animate-pulse text-xs">…</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
