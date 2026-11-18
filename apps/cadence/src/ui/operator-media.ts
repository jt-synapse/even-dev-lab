// Browser-side Logitech webcam WebRTC capture & Mac 16kHz microphone recorder
// used when Cadence is opened on the Mac Operator Station (`?role=operator`).

import { encodeBytesToBase64, encodePcm16LeToWav } from "../domain/wav.ts";

export interface VideoDeviceOption {
  readonly deviceId: string;
  readonly label: string;
}

export interface OperatorMediaState {
  readonly webcamActive: boolean;
  readonly devices: readonly VideoDeviceOption[];
  readonly selectedDeviceId: string;
  readonly activeDeviceLabel: string;
  readonly macMicRecording: boolean;
  readonly statusNote: string;
}

export interface OperatorMediaController {
  getState(): OperatorMediaState;
  attachVideoElement(video: HTMLVideoElement | null): void;
  startWebcam(preferredDeviceId?: string): Promise<boolean>;
  stopWebcam(): void;
  captureJpegFrame(): {
    imageBase64: string;
    mimeType: string;
    sourceLabel: string;
  } | null;
  startMacMicRecording(): Promise<void>;
  stopMacMicAndEncodeWav(): Promise<string | null>;
  dispose(): void;
}

const LOGITECH_LABEL_RE =
  /logitech|brio|c920|c922|c925|c930|streamcam|mx brio/i;

function floatTo16BitPcmChunk(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    const val = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
    view.setInt16(i * 2, val, true);
  }
  return bytes;
}

export function createOperatorMediaController(
  onChange: (state: OperatorMediaState) => void,
): OperatorMediaController {
  let stream: MediaStream | null = null;
  let videoEl: HTMLVideoElement | null = null;
  let devices: VideoDeviceOption[] = [];
  let selectedDeviceId = "";
  let activeDeviceLabel = "Not connected";
  let macMicRecording = false;
  let statusNote =
    "Click 'Connect Logitech Webcam' to arm instant R1 snapshots.";

  // Mac mic state
  let micStream: MediaStream | null = null;
  let audioCtx: AudioContext | null = null;
  let micPcmChunks: Uint8Array[] = [];

  const getState = (): OperatorMediaState => ({
    webcamActive: stream !== null,
    devices,
    selectedDeviceId,
    activeDeviceLabel,
    macMicRecording,
    statusNote,
  });

  const notify = () => {
    onChange(getState());
  };

  const refreshVideoDevices = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices();
    const videoInputs = all.filter((d) => d.kind === "videoinput");
    devices = videoInputs.map((d, idx) => ({
      deviceId: d.deviceId,
      label: d.label || `Camera #${idx + 1}`,
    }));
  };

  const stopWebcam = () => {
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      stream = null;
    }
    if (videoEl) {
      videoEl.srcObject = null;
    }
    activeDeviceLabel = "Stopped";
    statusNote = "Logitech webcam stopped.";
    notify();
  };

  const startWebcam = async (preferredDeviceId?: string): Promise<boolean> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      statusNote = "Browser getUserMedia unavailable (use localhost or HTTPS).";
      notify();
      return false;
    }

    try {
      stopWebcam();
      // Initial permission request unlocks camera labels if devices aren't enumerated yet.
      await refreshVideoDevices();
      const autoLogitech = devices.find((d) => LOGITECH_LABEL_RE.test(d.label));
      const targetId =
        preferredDeviceId || selectedDeviceId || autoLogitech?.deviceId || "";

      const constraints: MediaStreamConstraints = {
        video: targetId
          ? {
              deviceId: { exact: targetId },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            }
          : { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      };

      let opened = await navigator.mediaDevices.getUserMedia(constraints);
      await refreshVideoDevices();

      // If labels just unlocked and a Logitech camera exists while a built-in cam opened, switch to Logitech!
      if (!preferredDeviceId && !selectedDeviceId) {
        const discoveredLogitech = devices.find((d) =>
          LOGITECH_LABEL_RE.test(d.label),
        );
        const currentTrackLabel = opened.getVideoTracks()[0]?.label ?? "";
        if (
          discoveredLogitech &&
          discoveredLogitech.deviceId &&
          !LOGITECH_LABEL_RE.test(currentTrackLabel)
        ) {
          for (const t of opened.getTracks()) t.stop();
          opened = await navigator.mediaDevices.getUserMedia({
            video: {
              deviceId: { exact: discoveredLogitech.deviceId },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: false,
          });
        }
      }

      stream = opened;
      const track = opened.getVideoTracks()[0];
      const settings = track?.getSettings();
      selectedDeviceId = settings?.deviceId ?? targetId;
      activeDeviceLabel = track?.label || "Mac Webcam";
      statusNote = `Armed: ${activeDeviceLabel} (R1 Ring tap ready)`;

      if (videoEl) {
        videoEl.srcObject = stream;
        void videoEl.play().catch(() => {});
      }
      notify();
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      statusNote = `Webcam error: ${msg}`;
      notify();
      return false;
    }
  };

  const captureJpegFrame = () => {
    if (!stream || !videoEl || videoEl.videoWidth === 0) {
      return null;
    }
    const canvas = document.createElement("canvas");
    canvas.width = videoEl.videoWidth;
    canvas.height = videoEl.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.86);
    const commaIdx = dataUrl.indexOf(",");
    const imageBase64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
    return {
      imageBase64,
      mimeType: "image/jpeg",
      sourceLabel: activeDeviceLabel,
    };
  };

  const startMacMicRecording = async () => {
    if (macMicRecording || !navigator.mediaDevices?.getUserMedia) return;
    micPcmChunks = [];
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: false,
    });
    audioCtx = new AudioContext({ sampleRate: 16000 });
    const source = audioCtx.createMediaStreamSource(micStream);
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (ev) => {
      if (!macMicRecording) return;
      const channelData = ev.inputBuffer.getChannelData(0);
      micPcmChunks.push(floatTo16BitPcmChunk(channelData));
    };
    source.connect(processor);
    processor.connect(audioCtx.destination);
    macMicRecording = true;
    statusNote = "Recording Mac Microphone (16 kHz PCM)...";
    notify();
  };

  const stopMacMicAndEncodeWav = async (): Promise<string | null> => {
    if (!macMicRecording) return null;
    macMicRecording = false;
    if (micStream) {
      for (const t of micStream.getTracks()) t.stop();
      micStream = null;
    }
    if (audioCtx) {
      await audioCtx.close().catch(() => {});
      audioCtx = null;
    }
    const chunks = micPcmChunks;
    micPcmChunks = [];
    statusNote = stream
      ? `Armed: ${activeDeviceLabel}`
      : "Mac microphone recording sent.";
    notify();
    const wavBytes = encodePcm16LeToWav(chunks, 16000, 1);
    return encodeBytesToBase64(wavBytes);
  };

  return {
    getState,
    attachVideoElement(video: HTMLVideoElement | null) {
      videoEl = video;
      if (videoEl && stream && videoEl.srcObject !== stream) {
        videoEl.srcObject = stream;
        void videoEl.play().catch(() => {});
      }
    },
    startWebcam,
    stopWebcam,
    captureJpegFrame,
    startMacMicRecording,
    stopMacMicAndEncodeWav,
    dispose() {
      stopWebcam();
      void stopMacMicAndEncodeWav();
    },
  };
}
