import { NextResponse } from "next/server";
import path from "path";
import { spawnSync } from "child_process";
import fs from "fs";

export async function POST() {
  try {
    const pipelineDir = path.resolve(process.cwd(), "../pipeline");
    const scriptPath = path.join(pipelineDir, "contradiction_detector.py");

    if (!fs.existsSync(scriptPath)) {
      return NextResponse.json({
        success: false,
        message: "Contradiction detector script is unavailable in this deployment. Run ./pipeline/contradiction_detector.py locally.",
      });
    }

    const result = spawnSync("python", [scriptPath], {
      encoding: "utf-8",
      cwd: pipelineDir,
      timeout: 10 * 60 * 1000, // 10 minutes — this can call the LLM many times
      maxBuffer: 10 * 1024 * 1024, // 10MB, in case of a large stdout
    });

    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(result.stderr || "Contradiction detector failed.");
    }

    return NextResponse.json({ success: true, output: result.stdout });
  } catch (error: unknown) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}