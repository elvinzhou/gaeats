import { spawn } from "node:child_process";

const commands = [
  ["node", ["--experimental-transform-types", "scripts/import-faa-airports.js"]],
  [
    "node",
    ["--experimental-transform-types", "scripts/sync-google-pois.js", "--type=RESTAURANT"],
  ],
  [
    "node",
    ["--experimental-transform-types", "scripts/sync-google-pois.js", "--type=ATTRACTION"],
  ],
];

for (const [command, args] of commands) {
  await run(command, args);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      cwd: process.cwd(),
      env: process.env,
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} failed with code ${code}`));
    });
  });
}
