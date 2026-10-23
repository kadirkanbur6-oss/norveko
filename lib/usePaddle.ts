"use client";

// Paddle.js'i yükleyip başlatan hook.

import { useEffect, useState } from "react";
import {
  initializePaddle,
  type Paddle,
  type PaddleEventData,
} from "@paddle/paddle-js";
import { getPaddleEnvironment } from "./paddle-env";

export function usePaddle(onEvent?: (event: PaddleEventData) => void) {
  const [paddle, setPaddle] = useState<Paddle | undefined>(undefined);

  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
    if (!token) {
      console.error("[paddle] NEXT_PUBLIC_PADDLE_CLIENT_TOKEN is not set");
      return;
    }

    initializePaddle({
      environment: getPaddleEnvironment(),
      token,
      eventCallback: onEvent,
    }).then((instance) => {
      if (instance) setPaddle(instance);
    });
    // onEvent is intentionally not a dependency: Paddle.js is initialised once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return paddle;
}
