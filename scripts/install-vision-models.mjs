import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MODELS = Object.freeze([
  Object.freeze({
    name: "face landmark",
    filename: "face_landmarker.task",
    url: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
    sha256: "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff",
  }),
  Object.freeze({
    name: "multiclass selfie segmentation",
    filename: "selfie_multiclass_256x256.tflite",
    url: "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite",
    sha256: "c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0",
  }),
]);

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const modelDirectory = resolve(projectRoot, "public", "models");

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function existingFileHash(filePath) {
  try {
    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) throw new Error(`Vision model path is not a file: ${filePath}`);
    return sha256File(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function downloadModel(model, destinationPath) {
  const response = await fetch(model.url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(
      `Could not download the ${model.name} model (${response.status} ${response.statusText})`,
    );
  }

  const handle = await open(destinationPath, "wx", 0o600);
  const hash = createHash("sha256");
  try {
    for await (const chunk of response.body) {
      hash.update(chunk);
      let offset = 0;
      while (offset < chunk.byteLength) {
        const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset);
        offset += bytesWritten;
      }
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

async function installModel(model) {
  const modelPath = resolve(modelDirectory, model.filename);
  const installedHash = await existingFileHash(modelPath);
  if (installedHash !== null) {
    if (installedHash !== model.sha256) {
      throw new Error(
        `The existing ${model.name} model failed checksum verification. Expected ${model.sha256}, received ${installedHash}. Delete ${modelPath} and run npm run setup:model again.`,
      );
    }
    console.log(`MediaPipe ${model.name} model is already installed and verified.`);
    return;
  }

  const temporaryPath = resolve(
    modelDirectory,
    `.${model.filename}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    console.log(`Downloading the MediaPipe ${model.name} model…`);
    const downloadedHash = await downloadModel(model, temporaryPath);
    if (downloadedHash !== model.sha256) {
      throw new Error(
        `Downloaded ${model.name} model failed checksum verification. Expected ${model.sha256}, received ${downloadedHash}.`,
      );
    }
    await rename(temporaryPath, modelPath);
    console.log(`MediaPipe ${model.name} model installed and verified.`);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

await mkdir(modelDirectory, { recursive: true });
for (const model of MODELS) await installModel(model);
