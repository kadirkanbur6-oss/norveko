"use client";

import { useEffect } from "react";
import { supabase } from "./lib/supabase";

export default function TestSupabase() {
  useEffect(() => {
    async function testConnection() {
      const { data, error } = await supabase
        .from("test")
        .select("*");

      console.log("DATA:", data);
      console.log("ERROR:", error);
    }

    testConnection();
  }, []);

  return (
    <div className="p-6 text-white">
      Testing Supabase connection...
    </div>
  );
}