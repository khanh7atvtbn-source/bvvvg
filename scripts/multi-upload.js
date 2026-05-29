const config = require("../config/config");
const { getAccount, normalizeVideo, parseArgs, readJson, uploadVideo, writeJson } = require("./upload");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const queuePath = args.queue || config.paths.queue;
  const queue = readJson(queuePath, []);

  if (!Array.isArray(queue) || queue.length === 0) {
    throw new Error("data/queue.json dang rong. Hay them danh sach video can upload.");
  }

  const uploaded = readJson(config.paths.uploaded, []);
  const results = [];

  for (let index = 0; index < queue.length; index += 1) {
    const item = queue[index];
    if (item.done) continue;

    const { accountName, account } = getAccount(item.account || args.account);
    const video = normalizeVideo(item);
    const result = await uploadVideo({
      accountName,
      account,
      video,
      keepOpen: Boolean(args["keep-open"]),
    });

    queue[index] = {
      ...item,
      done: true,
      uploadedAt: result.uploadedAt,
      url: result.url,
    };
    uploaded.push(result);
    results.push(result);

    writeJson(queuePath, queue);
    writeJson(config.paths.uploaded, uploaded);
  }

  console.log(JSON.stringify(results, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
