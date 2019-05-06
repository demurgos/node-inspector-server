import chai from "chai";
import cp from "child_process";
import cri from "chrome-remote-interface";
import rx from "rxjs";
import { InspectorClient, InspectorServer } from "../lib/index";

describe("InspectorServer", function () {
  it("should be open then closed", async function () {
    const srv: InspectorServer = await InspectorServer.open();
    srv.closeSync();
    // We just check that there's no crash and the tests don't hang.
  });

  it("manually spawns an inspected process", async function () {
    let clientSubscription: rx.Subscription | undefined;
    let child: cp.ChildProcessWithoutNullStreams | undefined;
    const events: string[] = [];
    const outChunks: Buffer[] = [];
    let cleanedUp: boolean = false;

    setTimeout(cleanUp, 10000);

    const server: InspectorServer = await InspectorServer.open();
    events.push("openServer");
    try {
      await withServer(server);
    } finally {
      cleanUp();
    }

    function cleanUp(): void {
      if (cleanedUp) {
        return;
      }
      cleanedUp = true;
      if (clientSubscription !== undefined) {
        clientSubscription.unsubscribe();
      }
      if (child !== undefined) {
        process.kill(child.pid, "SIGTERM");
      }
      server.closeSync();
    }

    chai.assert.deepEqual(
      events,
      [
        "openServer",
        "spawnProcess",
        "clientNotification",
        "clientConnection",
        "enableRuntime",
        "close: {\"code\":0,\"signal\":null}",
        "complete",
      ],
    );

    async function withServer(server: InspectorServer): Promise<void> {
      return new Promise((resolve, reject) => {

        clientSubscription = server.subscribe(
          async (client: InspectorClient) => {
            try {
              await withClient(client);
            } catch (err) {
              reject(err);
            }
          },
          (err: Error) => {
            reject(err);
          },
          () => {
            events.push("complete");
            try {
              const out: string = Buffer.concat(outChunks).toString("UTF-8").trim();
              chai.assert.strictEqual(out, "Hello, World!");
              resolve();
            } catch (err) {
              reject(err);
            }
          },
        );

        const helloWorldFixture: string = require.resolve("./fixtures/hello-world");

        child = server.spawn(process.execPath, [helloWorldFixture]);
        events.push("spawnProcess");
        child.stdout.on("data", c => outChunks.push(c));

        child.on("close", function (code, signal) {
          events.push(`close: ${JSON.stringify({code, signal})}`);
          child = undefined;
          if (code !== 0) {
            reject(new Error("NonZeroExitCode"));
          } else {
            server.closeSync();
          }
        });
      });
    }

    async function withClient(clientNotification: InspectorClient): Promise<void> {
      events.push("clientNotification");
      chai.assert.isString(clientNotification.url);
      const client: any = await cri({target: clientNotification.url});
      events.push("clientConnection");
      const out: string = Buffer.concat(outChunks).toString("UTF-8").trim();
      chai.assert.strictEqual(out, "");
      await client.Runtime.enable();
      await client.Runtime.runIfWaitingForDebugger();

      client.on("Runtime.executionContextDestroyed", () => client.close());

      events.push("enableRuntime");
    }
  });
});
