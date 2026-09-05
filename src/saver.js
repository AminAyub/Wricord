async function writeBlob(directory, filename, blob) {
  const fileHandle = await directory.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();

  try {
    await writable.write(blob);
    await writable.close();
  } catch (error) {
    try {
      await writable.abort?.();
    } catch {
      // Preserve the original write error if the stream is already closed.
    }
    throw error;
  }
}

export async function saveRecordingPair(directory, recording) {
  if (!directory?.getFileHandle) {
    throw new TypeError("A writable recording folder is required");
  }
  if (!recording?.blob || !recording?.markdownBlob) {
    throw new TypeError("Video and Markdown data are required");
  }

  await writeBlob(directory, recording.filename, recording.blob);
  await writeBlob(directory, recording.markdownFilename, recording.markdownBlob);
}
