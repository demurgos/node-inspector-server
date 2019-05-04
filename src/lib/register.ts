/**
 * This file is intended to be passed to Node with `--require <path>`.
 *
 * If the `NODE_INSPECTOR_SERVER` (case-sensitive) is set and is a
 * coma-separated list of port numbers, the script runs.
 * It starts the inspector on the current process and for each port sends a
 * notification.
 * The port is expected to be an open port listening to `127.0.0.1`.
 * The notification is a single-line JSON object followed by a newline.
 * The notification has a single key: `url`, the url of the Node
 * inspector attached to this process.
 * Example: `ws://127.0.0.1:9229/62a684d5-1286-472d-8fa9-9151d718cbaa`
 */

import fs from "fs";
import url from "url";

const SERVER_ENV_VAR: string = "NODE_INSPECTOR_SERVER"; // Must match the value in `index.ts`

interface Notification {
  url: string;
}

function main() {
  let serverFiles: ReadonlySet<url.URL>;
  try {
    serverFiles = getServerFiles();
  } catch (err) {
    console.warn("node-inspector-server:", err);
    return;
  }

  // tslint:disable-next-line:no-require-imports typedef
  const inspector = require("inspector");

  // TODO: Add option to hide debugger message
  inspector.open(0);

  const url: string | undefined = inspector.url();
  if (typeof url !== "string") {
    console.warn("node-inspector-server: Failed to open inspector: ", url);
    return;
  }
  const notification: Notification = {url};
  const message: string = serializeNotification(notification);

  for (const serverFile of serverFiles) {
    try {
      sendNotification(serverFile, message);
    } catch (err) {
      console.warn(`node-inspector-server: Failed to notify server ${serverFile.toString()}`, err);
    }
  }

  // Wait for connection (`Runtime.runIfWaitingForDebugger`)
  inspector.open(undefined, undefined, true);
}

function sendNotification(serverFile: url.URL, message: string): void {
  fs.appendFileSync(serverFile, message);
}

function getServerFiles(): Set<url.URL> {
  const raw: string | undefined = process.env[SERVER_ENV_VAR];
  if (raw === undefined) {
    throw new Error(`Missing env variable: ${SERVER_ENV_VAR}`);
  }
  return parseServerFiles(raw);
}

function parseServerFiles(input: string): Set<url.URL> {
  try {
    const values: any = JSON.parse(input);
    if (!Array.isArray(values) || values.some(item => typeof item !== "string")) {
      throw new Error("Invalid type, expected `string[]`");
    }
    const result: Set<url.URL> = new Set();
    for (const item of values) {
      const serverUrl: url.URL = new url.URL(item);
      if (serverUrl.protocol !== "file:") {
        // TODO: Support `tcp` protocol?
        throw new Error(`Unsupported protocol: ${serverUrl.protocol}`);
      }
      result.add(serverUrl);
    }
    return result;
  } catch (err) {
    throw new Error(`Invalid ${SERVER_ENV_VAR} (${JSON.stringify(input)}): ${err.message}`);
  }
}

function serializeNotification(notification: Notification): string {
  return `${JSON.stringify({url: notification.url})}\n`;
}

try {
  main();
} catch (err) {
  console.error("node-inspector-server: Failed to register node inspector client: ", err);
}
