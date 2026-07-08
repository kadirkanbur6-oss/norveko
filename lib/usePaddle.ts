"use client";

// Paddle.js'i yükleyip başlatan hook.

import { useEffect, useState } from "react";
import {
  initializePaddle,
  type Paddle,
} from "@paddle/paddle-js";

export function usePaddle() {
  const [paddle, setPaddle] = useState<Paddle | undefined>(undefined);

  useEffect(() => {
    initializePaddle({
      environment:
        process.env.NEXT_PUBLIC_PADDLE_ENV === "production"
          ? "production"
          : "sandbox",
      token: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN!,
    }).then((instance) => {
      if (instance) setPaddle(instance);
    });
  }, []);

  return paddle;
}
