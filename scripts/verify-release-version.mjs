import fs from "node:fs";

const tag = String(process.argv[2] || "");
const rootPackage = JSON.parse(fs.readFileSync("package.json", "utf8"));
const dashboardPackage = JSON.parse(
  fs.readFileSync("dashboard/package.json", "utf8")
);
const expectedTag = `v${rootPackage.version}`;

if (tag !== expectedTag) {
  throw new Error(`Release tag ${tag || "<missing>"} must equal ${expectedTag}`);
}
if (dashboardPackage.version !== rootPackage.version) {
  throw new Error("Root and dashboard package versions must match");
}
if (!/^1\.\d+\.\d+$/.test(rootPackage.version)) {
  throw new Error("Only stable v1+ semantic versions can use this workflow");
}

console.log(`release metadata verified for ${tag}`);
