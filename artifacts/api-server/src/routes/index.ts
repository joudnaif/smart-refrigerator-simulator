import { Router, type IRouter } from "express";
import healthRouter from "./health";
import smartFridgeRouter from "./smart-fridge";

const router: IRouter = Router();

router.use(healthRouter);
router.use(smartFridgeRouter);

export default router;
