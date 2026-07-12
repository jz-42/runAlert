const fs = require("fs");
const path = require("path");
const { notarize } = require("@electron/notarize");

async function notarizeMac(context) {
  const { electronPlatformName, appOutDir, packager } = context;

  if (electronPlatformName !== "darwin") return;

  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  if (!fs.existsSync(appPath)) {
    throw new Error(`Cannot notarize missing app bundle: ${appPath}`);
  }

  const keychainProfile =
    process.env.APPLE_NOTARYTOOL_KEYCHAIN_PROFILE ||
    process.env.NOTARYTOOL_KEYCHAIN_PROFILE ||
    "";

  if (keychainProfile) {
    console.log(`[notarize] submitting with keychain profile "${keychainProfile}"`);
    await notarize({
      appPath,
      keychainProfile,
    });
    return;
  }

  const appleId = process.env.APPLE_ID || "";
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD || "";
  const teamId = process.env.APPLE_TEAM_ID || "";

  if (!appleId || !appleIdPassword || !teamId) {
    if (process.env.RUNALERT_REQUIRE_NOTARIZATION === "1") {
      throw new Error(
        "Apple notarization credentials are required for packaged Mac releases. " +
          "Configure a notarytool keychain profile or APPLE_ID, " +
          "APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID."
      );
    }
    console.log("[notarize] skipping: no keychain profile or Apple notarization env vars");
    return;
  }

  console.log(`[notarize] submitting with Apple ID for team ${teamId}`);
  await notarize({
    appPath,
    appleId,
    appleIdPassword,
    teamId,
  });
}

module.exports = notarizeMac;
module.exports.default = notarizeMac;
