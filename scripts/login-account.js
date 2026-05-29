const { main } = require("./login");

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
