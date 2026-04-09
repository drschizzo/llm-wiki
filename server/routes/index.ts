import { Router } from "express";
import { adminRouter } from "./admin.routes";
import { graphRouter } from "./graph.routes";
import { wikiRouter, searchRouter } from "./wiki.routes";
import { ingestRouter } from "./ingest.routes";
import { chatRouter } from "./chat.routes";
import { clusterRouter } from "./cluster.routes";

const apiRouter = Router();

apiRouter.use("/admin", adminRouter);
apiRouter.use("/graph", graphRouter);
apiRouter.use("/wiki", wikiRouter);
apiRouter.use("/search", searchRouter);
apiRouter.use("/ingest", ingestRouter);
apiRouter.use("/chat", chatRouter);
apiRouter.use("/clusters", clusterRouter);

export default apiRouter;

