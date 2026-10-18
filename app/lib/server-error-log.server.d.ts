import type {HandleErrorFunction} from "react-router";

export function logServerFailure(stage: "render" | "request", request: Request): void;
export const handleServerError: HandleErrorFunction;
