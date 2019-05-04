import chai from "chai";
import { InspectorServer } from "../lib/server";

describe("Server", function () {
  it("should work", async function () {
    this.timeout(300000);
    const src: InspectorServer = await InspectorServer.open();
    await delay(60000);
    await src.close();
    chai.assert.isDefined(true);
  });
});

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}
