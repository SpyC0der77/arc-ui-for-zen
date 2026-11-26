/* The running Zen version's data from zen-versions/ and the helpers that apply
 * its renames. One instance per browser process; see dev/ZEN-VERSIONS.md. */
import { NetUtil } from "resource://gre/modules/NetUtil.sys.mjs";

const RUNTIME = "chrome://zennia-runtime/content/";
const scope = {};
Services.scriptloader.loadSubScript("chrome://zennia/content/shared/zen-data.js", scope, "UTF-8");
const { ZenniaZenData } = scope;

function readText(url) {
  const channel = NetUtil.newChannel({ uri: url, loadUsingSystemPrincipal: true });
  const stream = channel.open();
  try {
    return NetUtil.readInputStreamToString(stream, stream.available(), { charset: "UTF-8" });
  } finally {
    stream.close();
  }
}
const readJSON = (url) => JSON.parse(readText(url));

export const zen = ZenniaZenData.create(
  ZenniaZenData.resolve(
    readJSON(RUNTIME + "zen-versions/base.json"),
    readJSON(`${RUNTIME}zen-versions/${Services.appinfo.version}.json`),
  ),
  { readText, importModule: (url) => ChromeUtils.importESModule(url) },
);
