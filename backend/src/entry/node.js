import { config } from "../config.node.js";
import { repository } from "../db/index.node.js";
import { app } from "../app/nodeApp.js";

repository.initDataStore()
  .then(() => {
    app.listen(config.port, () => {
      console.log(`Backend running on http://localhost:${config.port}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize Test database", err);
    process.exit(1);
  });
