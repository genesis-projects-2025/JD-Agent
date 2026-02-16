"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function Home() {
  const [status, setStatus] = useState("");

  useEffect(() => {
    api.get("/").then((res) => {
      setStatus(res.data.status);
    });
  }, []);

  return (
    <div className="p-10">
      <h1 className="text-xl font-bold">Backend Status: {status}</h1>
    </div>
  );
}
