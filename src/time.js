const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

const pad = (value) => String(value).padStart(2, "0");

export function formatTimestamp(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }

  return `${pad(date.getDate())} ${MONTHS[date.getMonth()]} ${date.getFullYear()}  ·  ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function toDateInputValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function toTimeInputValue(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parseLocalDateTime(dateValue, timeValue) {
  const dateParts = String(dateValue).split("-").map(Number);
  const timeParts = String(timeValue).split(":").map(Number);

  if (
    dateParts.length !== 3 ||
    timeParts.length < 2 ||
    [...dateParts, ...timeParts].some((part) => !Number.isFinite(part))
  ) {
    return null;
  }

  const [year, month, day] = dateParts;
  const [hour, minute] = timeParts;
  const result = new Date(year, month - 1, day, hour, minute, 0, 0);

  if (
    result.getFullYear() !== year ||
    result.getMonth() !== month - 1 ||
    result.getDate() !== day ||
    result.getHours() !== hour ||
    result.getMinutes() !== minute
  ) {
    return null;
  }

  return result;
}

export function recordingFilename(date, extension) {
  const safeExtension = String(extension || "webm").replace(/[^a-z0-9]/gi, "").toLowerCase() || "webm";
  return `wricord-${toDateInputValue(date)}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.${safeExtension}`;
}
