import assert from "assert";
import cp from "child_process";
import * as rx from "rxjs";
import tail from "tail";
import tmp from "tmp";
import url from "url";

const SERVER_ENV_VAR: string = "NODE_INSPECTOR_SERVER"; // Must match the value in `register.ts`
const NODE_OPTIONS_ENV_VAR: string = "NODE_OPTIONS";

export interface InspectorClient {
  /**
   * Inspector URL for this client.
   *
   * Example: `ws://127.0.0.1:9229/62a684d5-1286-472d-8fa9-9151d718cbaa`
   */
  url: string;
}

/**
 * Spawn options, with custom `spawn` function.
 */
export interface SpawnOptions extends cp.SpawnOptions {
  /**
   * Spawn function to use.
   *
   * You can supply your own spawn function.
   * For example, you can use `cross-spawn` or a `spawn-wrap` function.
   *
   * Default: `require("child_process").spawn`
   */
  spawn?: typeof cp.spawn;
}

export interface InspectorClient {
  url: string;
}

export class InspectorServer {
  private readonly file: tmp.FileResult;
  private readonly fileWatcher: tail.Tail;
  private readonly clients: rx.Subject<InspectorClient>;

  private constructor(file: tmp.FileResult) {
    const clients: rx.Subject<InspectorClient> = new rx.Subject();

    this.file = file;
    this.clients = clients;

    const fileWatcher: tail.Tail = new tail.Tail(
      file.name,
      {separator: "\n", fromBeginning: true, encoding: "UTF-8", follow: true},
    );
    fileWatcher.on("line", onLine);
    fileWatcher.on("error", onError);
    this.fileWatcher = fileWatcher;

    function onLine(data: string): void {
      console.log("line");
      const client: any = JSON.parse(data);
      assert(typeof client === "object" && client !== null && typeof client.url === "string");
      clients.next(client);
    }

    function onError(err: Error): void {
      clients.error(err);
    }
  }

  public static openSync(): InspectorServer {
    return new InspectorServer(tmp.fileSync());
  }

  public static async open(): Promise<InspectorServer> {
    const file: tmp.FileResult = await new Promise<tmp.FileResult>((resolve, reject) => {
      tmp.file((err: Error | null, name: string, fd: number, removeCallback: () => void) => {
        if (err !== null) {
          reject(err);
        } else {
          resolve({name, fd, removeCallback});
        }
      });
    });
    return new InspectorServer(file);
  }

  public wrapEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const oldEnv: NodeJS.ProcessEnv = env !== undefined ? env : process.env;

    const option: string = `--require=${JSON.stringify(require.resolve("./register-node-inspector-client"))}`;

    let nodeOptions: string = option;
    const oldNodeOptions: string | undefined = oldEnv[NODE_OPTIONS_ENV_VAR];
    if (oldNodeOptions !== undefined) {
      nodeOptions = `${option} ${oldNodeOptions}`;
    }

    const serverFileUrl: string = url.pathToFileURL(this.file.name).toString();
    let serverList: string = JSON.stringify([serverFileUrl]);
    const oldServerList: string | undefined = oldEnv[SERVER_ENV_VAR];
    if (oldServerList !== undefined) {
      const servers: string[] = JSON.parse(oldServerList);
      assert(Array.isArray(servers));
      servers.unshift(serverFileUrl);
      serverList = JSON.stringify(servers);
    }

    console.log({
      [NODE_OPTIONS_ENV_VAR]: nodeOptions,
      [SERVER_ENV_VAR]: serverList,
    });

    return {
      ...oldEnv,
      [NODE_OPTIONS_ENV_VAR]: nodeOptions,
      [SERVER_ENV_VAR]: serverList,
    };
  }

  public spawn(
    file: string,
    args?: readonly string[],
    options?: SpawnOptions,
  ): cp.ChildProcess {
    const spawnFn: typeof cp.spawn = options !== undefined && options.spawn !== undefined ? options.spawn : cp.spawn;
    const newOptions: cp.SpawnOptions = options !== undefined ? {...options} : {};
    newOptions.env = this.wrapEnv(newOptions.env);

    return spawnFn(file, args !== undefined ? args : [], newOptions);
  }

  public closeSync(): void {
    this.fileWatcher.unwatch();
    this.file.removeCallback();
    this.clients.complete();
  }

  subscribe(observer?: rx.PartialObserver<InspectorClient>): rx.Subscription;
  subscribe(
    next?: (value: InspectorClient) => void,
    error?: (error: Error) => void,
    complete?: () => void,
  ): rx.Subscription;
  public subscribe(...args: any[]): any {
    return this.clients.subscribe(...args);
  }
}
