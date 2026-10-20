const camera = document.querySelector("#camera");
const preview = document.querySelector("#preview");
const emptyState = document.querySelector("#empty-state");
const cameraButton = document.querySelector("#camera-button");
const captureButton = document.querySelector("#capture-button");
const retakeButton = document.querySelector("#retake-button");
const fileInput = document.querySelector("#file-input");
const descriptionInput = document.querySelector("#description");
const noteInput = document.querySelector("#note");
const elevationInput = document.querySelector("#elevation-toggle");
const elevationHelp = document.querySelector("#elevation-help");
const filenameElement = document.querySelector("#filename");
const saveButton = document.querySelector("#save-button");
const statusMessage = document.querySelector("#status-message");
const context = preview.getContext("2d");

let stream = null;
let photo = null;
let capturedAt = null;
let previewUrl = null;
let latestElevation = null;
let latestElevationAt = 0;
let capturedElevation = null;

const orientationAngle = () => window.screen.orientation?.angle ?? window.orientation ?? 0;
const normalizeAngle = (angle) => ((angle + 180) % 360 + 360) % 360 - 180;

if (!("DeviceOrientationEvent" in window)) {
  elevationInput.disabled = true;
  elevationHelp.textContent = "Camera tilt sensing is not available in this browser.";
}

function recordOrientation(event) {
  const angle = orientationAngle();
  if (event.beta === null || !Number.isFinite(event.beta) || ![0, 180].includes(angle)) {
    latestElevation = null;
    return;
  }
  latestElevation = normalizeAngle(event.beta - 90 + angle);
  latestElevationAt = Date.now();
}

async function enableOrientationSensor() {
  const requestPermission = window.DeviceOrientationEvent?.requestPermission;
  if (typeof requestPermission === "function") {
    const permission = await requestPermission.call(window.DeviceOrientationEvent);
    if (permission !== "granted") {
      throw new Error("Motion sensor permission was not granted.");
    }
  }
  window.addEventListener("deviceorientation", recordOrientation);
}

function getCurrentElevation() {
  return Date.now() - latestElevationAt <= 1500 ? latestElevation : null;
}

function setStatus(message = "") {
  statusMessage.textContent = message;
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  camera.srcObject = null;
}

function readExifDate(data, tiffStart, tiffLength) {
  const tiffEnd = tiffStart + tiffLength;
  if (tiffLength < 8 || tiffEnd > data.byteLength) return null;

  const byteOrder = data.getUint16(tiffStart, false);
  if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return null;
  const littleEndian = byteOrder === 0x4949;
  const read16 = (offset) => data.getUint16(offset, littleEndian);
  const read32 = (offset) => data.getUint32(offset, littleEndian);
  if (read16(tiffStart + 2) !== 42) return null;

  const isInTiff = (offset, length) => offset >= tiffStart && offset + length <= tiffEnd;
  const readDirectory = (offset) => {
    if (!isInTiff(offset, 2)) return [];
    const count = read16(offset);
    if (!isInTiff(offset + 2, count * 12)) return [];
    return Array.from({ length: count }, (_, index) => offset + 2 + index * 12);
  };
  const firstDirectory = tiffStart + read32(tiffStart + 4);
  const ifd0 = readDirectory(firstDirectory);
  const exifPointer = ifd0.find((entry) => read16(entry) === 0x8769);
  if (!exifPointer || read16(exifPointer + 2) !== 4) return null;

  const exifDirectory = tiffStart + read32(exifPointer + 8);
  const entries = readDirectory(exifDirectory);
  const dateEntry = entries.find((entry) => read16(entry) === 0x9003);
  if (!dateEntry || read16(dateEntry + 2) !== 2) return null;

  const count = read32(dateEntry + 4);
  const textOffset = count <= 4 ? dateEntry + 8 : tiffStart + read32(dateEntry + 8);
  if (!count || !isInTiff(textOffset, count)) return null;

  let value = "";
  for (let index = 0; index < count; index += 1) {
    const character = data.getUint8(textOffset + index);
    if (!character) break;
    value += String.fromCharCode(character);
  }

  const match = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const date = new Date(year, month - 1, day, hour, minute, second);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day
    || date.getHours() !== hour || date.getMinutes() !== minute || date.getSeconds() !== second) {
    return null;
  }
  return date;
}

function getExifTakenAt(buffer) {
  const data = new DataView(buffer);
  const isJpeg = data.byteLength >= 4 && data.getUint16(0, false) === 0xffd8;
  const isPng = data.byteLength >= 8
    && data.getUint32(0, false) === 0x89504e47
    && data.getUint32(4, false) === 0x0d0a1a0a;

  if (isJpeg) {
    let offset = 2;
    while (offset + 4 <= data.byteLength && data.getUint8(offset) === 0xff) {
      const marker = data.getUint8(offset + 1);
      if (marker === 0xda || marker === 0xd9) break;
      const segmentLength = data.getUint16(offset + 2, false);
      const segmentStart = offset + 4;
      const segmentEnd = offset + 2 + segmentLength;
      if (segmentLength < 2 || segmentEnd > data.byteLength) return null;
      if (marker === 0xe1 && segmentLength >= 8
        && data.getUint32(segmentStart, false) === 0x45786966
        && data.getUint16(segmentStart + 4, false) === 0) {
        const tiffStart = segmentStart + 6;
        return readExifDate(data, tiffStart, segmentEnd - tiffStart);
      }
      offset = segmentEnd;
    }
  }

  if (isPng) {
    let offset = 8;
    while (offset + 12 <= data.byteLength) {
      const chunkLength = data.getUint32(offset, false);
      const chunkStart = offset + 8;
      const chunkEnd = chunkStart + chunkLength;
      if (chunkEnd + 4 > data.byteLength) return null;
      if (data.getUint32(offset + 4, false) === 0x65584966) {
        return readExifDate(data, chunkStart, chunkLength);
      }
      if (data.getUint32(offset + 4, false) === 0x49454e44) break;
      offset = chunkEnd + 4;
    }
  }

  return null;
}

async function openCamera() {
  setStatus("");
  if (window.matchMedia("(pointer: coarse)").matches && !elevationInput.checked) {
    fileInput.click();
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Camera access is not available here. Choose a photo instead.");
    return;
  }

  stopCamera();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" } },
    });
    camera.srcObject = stream;
    camera.hidden = false;
    preview.hidden = true;
    emptyState.hidden = true;
    cameraButton.hidden = true;
    captureButton.hidden = false;
    retakeButton.hidden = true;
    await camera.play();
  } catch (error) {
    stopCamera();
    camera.hidden = true;
    preview.hidden = !photo;
    emptyState.hidden = Boolean(photo);
    cameraButton.hidden = Boolean(photo);
    captureButton.hidden = true;
    retakeButton.hidden = !photo;
    setStatus(error.name === "NotAllowedError"
      ? "Camera permission was denied. Allow camera access or choose a photo."
      : "Could not open the camera. Choose a photo instead.");
  }
}

function wrapText(text, maxWidth, ctx) {
  if (!text) return [];
  const words = text.trim().split(/\s+/);
  const lines = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      line = candidate;
      continue;
    }

    if (line) lines.push(line);
    line = "";
    let fragment = "";
    for (const character of word) {
      const next = fragment + character;
      if (fragment && ctx.measureText(next).width > maxWidth) {
        lines.push(fragment);
        fragment = character;
      } else {
        fragment = next;
      }
    }
    line = fragment;
  }

  if (line) lines.push(line);
  return lines;
}

function getTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return {
    stamp: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
    filename: `${date.getFullYear()}_${pad(date.getMonth() + 1)}_${pad(date.getDate())}_${pad(date.getHours())}_${pad(date.getMinutes())}_${pad(date.getSeconds())}`,
  };
}

function toSnakeCase(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function makeFilename() {
  const { filename } = getTimestamp(capturedAt);
  const description = toSnakeCase(descriptionInput.value);
  return `${filename}${description ? `_${description}` : ""}.png`;
}

function renderPreview() {
  if (!photo || !capturedAt) return;

  const width = photo.naturalWidth || photo.width;
  const height = photo.naturalHeight || photo.height;
  preview.width = width;
  preview.height = height;
  context.drawImage(photo, 0, 0, width, height);

  const scale = width / 1000;
  const padding = Math.max(14, 28 * scale);
  const fontSize = Math.max(15, 34 * scale);
  const lineHeight = fontSize * 1.3;
  const { stamp } = getTimestamp(capturedAt);
  const description = descriptionInput.value.trim();
  const firstLine = description ? `${stamp} · ${description}` : stamp;
  const elevationLines = elevationInput.checked && capturedElevation !== null
    ? [`Elevation: ${Math.round(capturedElevation)}°`]
    : [];
  const maxTextWidth = width - padding * 2;
  const fontFamily = '600 ' + fontSize + 'px "DM Sans", sans-serif';

  context.font = fontFamily;
  const firstLines = wrapText(firstLine, maxTextWidth, context);
  const wrappedElevationLines = elevationLines.flatMap((line) => wrapText(line, maxTextWidth, context));
  const noteLines = wrapText(noteInput.value, maxTextWidth, context);
  const gap = noteLines.length ? lineHeight * 0.35 : 0;
  const textHeight = (firstLines.length + wrappedElevationLines.length + noteLines.length) * lineHeight + gap;
  const footerPadding = padding * 0.75;
  const footerHeight = textHeight + footerPadding * 2;

  context.fillStyle = "rgba(10, 17, 14, 0.76)";
  context.fillRect(0, height - footerHeight, width, footerHeight);
  context.font = fontFamily;
  context.textBaseline = "top";
  context.fillStyle = "#ffffff";

  let y = height - footerHeight + footerPadding;
  for (const line of firstLines) {
    context.fillText(line, padding, y);
    y += lineHeight;
  }
  for (const line of wrappedElevationLines) {
    context.fillText(line, padding, y);
    y += lineHeight;
  }
  if (noteLines.length) {
    y += gap;
    context.font = `400 ${fontSize * 0.88}px "DM Sans", sans-serif`;
    for (const line of noteLines) {
      context.fillText(line, padding, y);
      y += lineHeight;
    }
  }

  filenameElement.textContent = makeFilename();
  preview.hidden = false;
  emptyState.hidden = true;
  saveButton.disabled = false;
}

function loadImage(blob, takenAt, statusMessageAfterLoad = "", elevation = null) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(blob);
  photo = null;
  capturedAt = null;
  capturedElevation = elevation;
  saveButton.disabled = true;
  photo = new Image();
  photo.onload = () => {
    capturedAt = takenAt;
    camera.hidden = true;
    preview.hidden = false;
    emptyState.hidden = true;
    captureButton.hidden = true;
    cameraButton.hidden = true;
    retakeButton.hidden = false;
    renderPreview();
    setStatus(statusMessageAfterLoad);
  };
  photo.onerror = () => {
    photo = null;
    capturedAt = null;
    preview.hidden = true;
    emptyState.hidden = false;
    cameraButton.hidden = false;
    retakeButton.hidden = true;
    saveButton.disabled = true;
    setStatus("This image could not be opened. Try choosing another photo.");
  };
  photo.src = previewUrl;
}

cameraButton.addEventListener("click", openCamera);

elevationInput.addEventListener("change", async () => {
  if (!elevationInput.checked) {
    window.removeEventListener("deviceorientation", recordOrientation);
    latestElevation = null;
    latestElevationAt = 0;
    renderPreview();
    return;
  }

  try {
    await enableOrientationSensor();
    if (photo) {
      setStatus("Elevation is available for photos taken with the in-page camera.");
    } else {
      setStatus("Tilt sensing is on. Take a photo with the in-page camera to stamp its elevation.");
    }
  } catch (error) {
    elevationInput.checked = false;
    window.removeEventListener("deviceorientation", recordOrientation);
    setStatus(error.message || "Could not access the camera tilt sensor.");
    return;
  }
  renderPreview();
});

captureButton.addEventListener("click", () => {
  if (!camera.videoWidth || !camera.videoHeight) {
    setStatus("The camera is not ready yet. Try again in a moment.");
    return;
  }

  const capturedPhoto = document.createElement("canvas");
  capturedPhoto.width = camera.videoWidth;
  capturedPhoto.height = camera.videoHeight;
  capturedPhoto.getContext("2d").drawImage(camera, 0, 0);
  const takenAt = new Date();
  capturedElevation = elevationInput.checked ? getCurrentElevation() : null;
  const captureStatus = elevationInput.checked && capturedElevation === null
    ? "No current tilt reading was available; the photo was captured without an elevation line."
    : "";
  capturedPhoto.toBlob((blob) => {
    if (!blob) {
      setStatus("Could not capture the photo. Please try again.");
      return;
    }
    stopCamera();
    loadImage(blob, takenAt, captureStatus, capturedElevation);
  }, "image/jpeg", 0.95);
});

retakeButton.addEventListener("click", openCamera);

fileInput.addEventListener("change", async () => {
  const [file] = fileInput.files;
  if (file) {
    stopCamera();
    try {
      const exifTakenAt = getExifTakenAt(await file.arrayBuffer());
      const takenAt = exifTakenAt || new Date(file.lastModified);
      const status = exifTakenAt
        ? "Using the capture time stored in this photo."
        : "No capture time found in the photo; using its file modified time.";
      loadImage(file, takenAt, elevationInput.checked
        ? `${status} Elevation is only available for photos taken with the in-page camera.`
        : status);
    } catch (error) {
      console.error("Could not read photo capture time.", error);
      loadImage(file, new Date(file.lastModified), elevationInput.checked
        ? "Could not read capture metadata; using the file's modified time. Elevation is only available for photos taken with the in-page camera."
        : "Could not read capture metadata; using the file's modified time.");
    }
  }
  fileInput.value = "";
});

descriptionInput.addEventListener("input", renderPreview);
noteInput.addEventListener("input", renderPreview);

saveButton.addEventListener("click", () => {
  if (!photo) return;
  preview.toBlob((blob) => {
    if (!blob) {
      setStatus("Could not save the stamped photo. Please try again.");
      return;
    }
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = makeFilename();
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    setStatus("Photo saved to your device.");
  }, "image/png");
});

window.addEventListener("pagehide", stopCamera);

if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.error("Could not register the offline app worker.", error);
    });
  });
}
