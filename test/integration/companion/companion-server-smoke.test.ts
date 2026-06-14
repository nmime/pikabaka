import fs from "fs";
import os from "os";
import path from "path";
import t from "tap";
import { WebSocket } from "ws";
import {
  CompanionCommand,
  CompanionServer,
} from "../../../electron/services/CompanionServer";

t.test(
  "phone companion smoke: pair, stream snapshot, send command, upload, revoke",
  async (t) => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "pika-companion-smoke-"),
    );
    const commands: CompanionCommand[] = [];
    const statuses: boolean[] = [];
    const server = new CompanionServer({
      userDataDir: tempRoot,
      onCommand: (command) => commands.push(command),
      onStatusChanged: (status) => statuses.push(status.running),
    });

    t.teardown(async () => {
      await server.stop();
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    const initialStatus = await server.createPairingCode();
    t.equal(
      initialStatus.running,
      true,
      "creating a pairing code starts the companion server",
    );
    t.type(initialStatus.port, "number", "server binds to an ephemeral port");
    t.ok(initialStatus.pairing?.token, "pairing token is returned");
    t.match(
      initialStatus.pairing?.qrDataUrl,
      /^data:image\/png;base64,/,
      "pairing QR is a PNG data URL",
    );

    const token = initialStatus.pairing!.token!;
    const baseUrl = `http://127.0.0.1:${initialStatus.port}`;

    const unauthenticated = await fetch(`${baseUrl}/api/snapshot`);
    t.equal(
      unauthenticated.status,
      401,
      "snapshot endpoint rejects missing token",
    );

    const page = await fetch(
      `${baseUrl}/pair?token=${encodeURIComponent(token)}`,
    );
    t.equal(page.status, 200, "pairing page loads");
    t.match(
      await page.text(),
      /Pika Companion/,
      "pairing page contains companion UI",
    );

    const ws = new WebSocket(
      `${baseUrl.replace("http:", "ws:")}/ws?token=${encodeURIComponent(token)}`,
    );
    t.teardown(() => ws.close());

    const hello = await waitForMessage(ws, "hello");
    t.ok(hello.payload.credential, "pairing issues a persistent credential");
    t.not(
      hello.payload.credential,
      token,
      "persistent credential differs from QR pairing token",
    );
    const credential = hello.payload.credential;
    const deviceId = hello.payload.deviceId;
    t.match(
      deviceId,
      /^[0-9a-f-]{36}$/i,
      "websocket authenticates as a generated trusted device id",
    );
    t.equal(
      server.getStatus().pairedDevices.length,
      1,
      "paired device is tracked after websocket auth",
    );
    t.equal(
      server.getStatus().pairing,
      null,
      "one-time pairing token is consumed after auth",
    );
    t.notMatch(
      JSON.stringify(server.getStatus()),
      credential,
      "raw persistent credential is not exposed in status",
    );

    const snapshot = {
      transcriptSegments: [
        {
          segmentId: "seg-1",
          speakerLabel: "Interviewer",
          text: "Can you walk me through your approach?",
          final: true,
        },
      ],
      messages: [
        {
          id: "msg-1",
          role: "assistant",
          intent: "answer",
          text: "Use STAR: situation, task, action, result.",
        },
      ],
      currentModel: "gemini-2.5-pro",
      providerName: "Gemini",
      meetingActive: true,
    };
    server.updateSnapshot(snapshot);

    const streamedSnapshot = await waitForMessage(ws, "snapshot");
    t.same(
      streamedSnapshot.payload.transcriptSegments,
      snapshot.transcriptSegments,
      "snapshot broadcast includes transcript rows",
    );
    t.same(
      streamedSnapshot.payload.messages,
      snapshot.messages,
      "snapshot broadcast includes assistant answers",
    );

    const commandAckPromise = waitForMessage(ws, "command-ack");
    const commandResponse = await postJson(
      `${baseUrl}/api/command?token=${encodeURIComponent(credential)}`,
      {
        type: "what_to_answer",
        payload: { text: "Need a concise response" },
      },
    );
    t.equal(
      commandResponse.status,
      200,
      "command endpoint accepts paired token",
    );
    t.equal(commandResponse.body.ok, true, "command endpoint returns success");
    t.equal(
      commands.at(-1)?.type,
      "what_to_answer",
      "desktop receives companion command",
    );
    t.same(
      commands.at(-1)?.payload,
      { text: "Need a concise response" },
      "desktop receives command payload",
    );

    const commandAck = await commandAckPromise;
    t.equal(
      commandAck.payload.type,
      "what_to_answer",
      "websocket receives command acknowledgement",
    );

    const uploadAckPromise = waitForMessage(ws, "command-ack");
    const uploadResponse = await postJson(
      `${baseUrl}/api/upload?token=${encodeURIComponent(credential)}`,
      {
        name: "../whiteboard.png",
        mime: "image/png",
        data: `data:image/png;base64,${Buffer.from("fake-png").toString("base64")}`,
      },
    );
    t.equal(uploadResponse.status, 200, "upload endpoint accepts paired token");
    t.equal(
      uploadResponse.body.uploaded.name,
      "whiteboard.png",
      "upload filename is sanitized",
    );
    t.equal(
      uploadResponse.body.command.type,
      "attach-file",
      "upload emits attach-file command",
    );
    t.ok(
      String(uploadResponse.body.uploaded.path).startsWith(tempRoot),
      "upload is written under companion upload directory",
    );
    t.equal(
      fs.readFileSync(uploadResponse.body.uploaded.path, "utf8"),
      "fake-png",
      "upload payload is decoded to disk",
    );
    const uploadAck = await uploadAckPromise;
    t.equal(
      uploadAck.payload.type,
      "attach-file",
      "websocket receives upload acknowledgement",
    );

    const persistedServer = new CompanionServer({ userDataDir: tempRoot });
    const persistedStatus = await persistedServer.start(0);
    t.teardown(async () => persistedServer.stop());
    const reconnect = await fetch(
      `http://127.0.0.1:${persistedStatus.port}/api/snapshot?token=${encodeURIComponent(credential)}`,
    );
    t.equal(
      reconnect.status,
      200,
      "persistent credential reconnects without a new QR after restart",
    );

    server.revokeDevice(deviceId);
    t.equal(
      server.getStatus().pairedDevices.length,
      0,
      "revoked device is removed from status",
    );

    const revoked = await fetch(
      `${baseUrl}/api/snapshot?token=${encodeURIComponent(credential)}`,
    );
    t.equal(revoked.status, 401, "revoked token can no longer fetch snapshots");
    t.ok(
      statuses.includes(true),
      "status callback fires while server is running",
    );
  },
);

async function postJson(
  url: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: any }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

function waitForMessage(socket: WebSocket, type: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(
        new Error(`Timed out waiting for companion websocket message: ${type}`),
      );
    }, 3000);

    const onMessage = (raw: WebSocket.RawData) => {
      const message = JSON.parse(String(raw));
      if (message.type !== type) return;
      cleanup();
      resolve(message);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      socket.off("error", onError);
    };

    socket.on("message", onMessage);
    socket.on("error", onError);
  });
}
