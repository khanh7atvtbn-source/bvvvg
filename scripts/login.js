const readline = require("readline");
const config = require("../config/config");
const { getAccount, launchBrowserSession } = require("./upload");

function waitForEnter(message) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}

async function main() {
  const accountArg = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : undefined;
  const { accountName, account } = getAccount(accountArg);

  const session = await launchBrowserSession(account);
  const { context } = session;

  const page = context.pages()[0] || (await context.newPage());
  await page.goto("https://studio.youtube.com", { waitUntil: "domcontentloaded" });
  console.log(`Da mo profile ${accountName} bang ${config.browser.provider}.`);
  console.log("Dang nhap YouTube/Google trong cua so Chrome vua mo.");
  await waitForEnter("Dang nhap xong thi quay lai terminal bam Enter de dong browser...");
  await session.close();
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { main };
