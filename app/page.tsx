"use client";

import { useState, useRef, useEffect } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

type StoryPage = {
  text: string;
  imagePrompt: string;
  imageUrl?: string;
  audioUrl?: string;
};

type StoryData = {
  title: string;
  pages: StoryPage[];
  prompt: string;
};

/**
 * The main React component for the Storybook application.  It accepts a user
 * prompt, sends it to the back‑end API to generate a story structure and
 * associated images, and then renders a preview.  The component also
 * supports saving and loading stories from local storage, re‑rolling
 * individual page images or text, and exporting the book as either a PDF
 * or a narrated MP4.  All heavy lifting (text generation, image creation,
 * speech synthesis, PDF/video export) happens on the client to keep the
 * server API thin.
 */
export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [story, setStory] = useState<StoryData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedStories, setSavedStories] = useState<Record<string, StoryData>>({});
  const [holdTime, setHoldTime] = useState(4); // seconds each page is shown in video
  const [fadeTime, setFadeTime] = useState(0.5); // seconds to fade between pages
  const bookRef = useRef<HTMLDivElement>(null);

  // Load any saved stories from localStorage on mount
  useEffect(() => {
    const raw = localStorage.getItem("storybook_saved");
    if (raw) {
      try {
        const obj = JSON.parse(raw);
        setSavedStories(obj);
      } catch (err) {
        console.warn("Failed to parse saved stories", err);
      }
    }
  }, []);

  /**
   * Persist the current story into localStorage under its title.  Any
   * existing story with the same title will be overwritten.  This allows
   * users to return to previously generated books without re‑querying the
   * API.
   */
  const saveStory = () => {
    if (!story) return;
    const updated = { ...savedStories, [story.title]: story };
    localStorage.setItem("storybook_saved", JSON.stringify(updated));
    setSavedStories(updated);
  };

  /**
   * Load a saved story by its title.  If the title exists in the saved map
   * it will become the active story, otherwise nothing happens.
   */
  const loadStory = (title: string) => {
    const saved = savedStories[title];
    if (saved) setStory(saved);
  };

  /**
   * Generate a story from the current prompt.  This calls our back‑end
   * endpoint `/api/generateStory` which uses OpenAI to produce a
   * structured JSON (title + 10 pages), then iterates through the pages
   * requesting images via `/api/generateImage`.  When complete the
   * assembled story is stored in state.
   */
  const generateStory = async () => {
    if (!prompt) return;
    setBusy(true);
    setError(null);
    setStory(null);
    try {
      const res = await fetch("/api/generateStory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) throw new Error(await res.text());
      const storyData = (await res.json()) as StoryData;
      storyData.prompt = prompt;
      // Generate images for each page concurrently
      const pagesWithImages = await Promise.all(
        storyData.pages.map(async (p) => {
          const img = await fetch("/api/generateImage", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: p.imagePrompt }),
          });
          if (!img.ok) throw new Error(await img.text());
          const { url } = await img.json();
          return { ...p, imageUrl: url };
        }),
      );
      setStory({ ...storyData, pages: pagesWithImages });
    } catch (err: any) {
      setError(err.message || "Failed to generate story");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Request a new image for the given page index.  The function calls the
   * `/api/generateImage` endpoint again with the original image prompt.  The
   * story state is updated immutably to reflect the new image URL.
   */
  const rerollImage = async (idx: number) => {
    if (!story) return;
    const page = story.pages[idx];
    if (!page) return;
    try {
      setBusy(true);
      const res = await fetch("/api/generateImage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: page.imagePrompt }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { url } = await res.json();
      const updatedPages = story.pages.map((p, i) =>
        i === idx ? { ...p, imageUrl: url } : p,
      );
      setStory({ ...story, pages: updatedPages });
    } catch (err: any) {
      alert(err.message || "Failed to re‑roll image");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Request a new text passage for the given page index by regenerating the
   * entire story using the original prompt and then plucking out the new
   * text for that page.  This approach trades API efficiency for
   * simplicity because OpenAI does not currently support page‑level text
   * regeneration.  All other pages remain unchanged.
   */
  const rerollText = async (idx: number) => {
    if (!story) return;
    try {
      setBusy(true);
      const res = await fetch("/api/generateStory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: story.prompt }),
      });
      if (!res.ok) throw new Error(await res.text());
      const newStory: StoryData = await res.json();
      const newText = newStory.pages[idx]?.text;
      if (!newText) throw new Error("No new text returned");
      const updatedPages = story.pages.map((p, i) =>
        i === idx ? { ...p, text: newText } : p,
      );
      setStory({ ...story, pages: updatedPages });
    } catch (err: any) {
      alert(err.message || "Failed to re‑roll text");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Export the current book to a PDF.  The DOM for each page is
   * rasterised with html2canvas at a high resolution, then inserted into
   * the PDF.  Each image is scaled to fit an A4 page (portrait).  The
   * resulting document is downloaded directly by the browser.  If no
   * story is loaded or the component is busy, nothing happens.
   */
  const downloadPDF = async () => {
    if (!story || !bookRef.current) return;
    setBusy(true);
    try {
      const doc = new jsPDF({ unit: "px", format: "a4" });
      const pages = Array.from(
        bookRef.current.querySelectorAll(".story-page"),
      ) as HTMLElement[];
      for (let i = 0; i < pages.length; i++) {
        const el = pages[i];
        const canvas = await html2canvas(el, { scale: 2 });
        const imgData = canvas.toDataURL("image/png");
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = (canvas.height * pageWidth) / canvas.width;
        if (i > 0) doc.addPage();
        doc.addImage(imgData, "PNG", 0, 0, pageWidth, pageHeight);
      }
      doc.save(`${story.title || "storybook"}.pdf`);
    } catch (err: any) {
      alert(err.message || "Failed to export PDF");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Generate a narrated video.  Each page is captured to a PNG and paired
   * with its narration audio (generated via `/api/generateAudio`).  The
   * function then uses FFmpeg WebAssembly to produce MP4 segments for
   * each page, complete with a page‑turn sound effect.  These segments
   * are concatenated into a final MP4 which is offered for download.  The
   * holdTime and fadeTime state values control how long each page stays
   * on screen and the duration of the fade transition.
   */
  const downloadVideo = async () => {
    if (!story || !bookRef.current) return;
    setBusy(true);
    try {
      // 1) Generate narration audio for each page
      const pagesWithAudio = await Promise.all(
        story.pages.map(async (p) => {
          const res = await fetch("/api/generateAudio", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: p.text }),
          });
          if (!res.ok) throw new Error(await res.text());
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          return { ...p, audioUrl: url };
        }),
      );

      // 2) Capture each page as a PNG
      const pageEls = Array.from(
        bookRef.current.querySelectorAll(".story-page"),
      ) as HTMLElement[];
      const images: { blob: Blob; name: string }[] = [];
      for (let i = 0; i < pageEls.length; i++) {
        const canvas = await html2canvas(pageEls[i], { scale: 2 });
        const dataUrl = canvas.toDataURL("image/png");
        const blob = await (await fetch(dataUrl)).blob();
        images.push({ blob, name: `page${i}.png` });
      }

      // 3) Load FFmpeg wasm
      const ffmpeg = new FFmpeg();
      await ffmpeg.load({
        coreURL: await toBlobURL(
          "https://unpkg.com/@ffmpeg/core@0.12.6/dist/ffmpeg-core.js",
          "text/javascript",
        ),
        wasmURL: await toBlobURL(
          "https://unpkg.com/@ffmpeg/core@0.12.6/dist/ffmpeg-core.wasm",
          "application/wasm",
        ),
      });

      // 4) Write the images and audio into FFmpeg FS
      await Promise.all(
        images.map((im) => ffmpeg.writeFile(im.name, fetchFile(im.blob))),
      );
      await Promise.all(
        pagesWithAudio.map(async (p, i) => {
          const blob = await (await fetch(p.audioUrl!)).blob();
          await ffmpeg.writeFile(`audio${i}.mp3`, fetchFile(blob));
        }),
      );

      // 5) Build segments with fades and page‑turn sound effect
      // Pre‑load a simple whoosh sound into FFmpeg FS (base64 encoded)
      const whoosh = await fetch(
        "https://cdn.jsdelivr.net/gh/mattt/ffmpeg-page-turn@main/whoosh.mp3",
      ).then((r) => r.arrayBuffer());
      await ffmpeg.writeFile("whoosh.mp3", new Uint8Array(whoosh));

      const listFile: string[] = ["ffconcat version 1.0"];
      for (let i = 0; i < pagesWithAudio.length; i++) {
        const imageName = images[i].name;
        // Create a video segment: loop the image for holdTime seconds, fade out
        const outName = `seg${i}.mp4`;
        await ffmpeg.exec([
          "-loop",
          "1",
          "-i",
          imageName,
          "-i",
          `audio${i}.mp3`,
          "-i",
          "whoosh.mp3",
          "-filter_complex",
          `[0:v]format=yuv420p,fade=t=out:st=${holdTime - fadeTime}:d=${fadeTime}[v1];[1:a]adelay=0|0[a1];[2:a]adelay=${
            (holdTime - fadeTime) * 1000
          }|${(holdTime - fadeTime) * 1000}[a2];[a1][a2]amix=inputs=2:duration=shortest[aout]`,
          "-map",
          "[v1]",
          "-map",
          "[aout]",
          "-c:v",
          "libx264",
          "-c:a",
          "aac",
          "-shortest",
          outName,
        ]);
        listFile.push(`file ${outName}`);
      }

      // 6) Write concat list and produce final video
      await ffmpeg.writeFile(
        "list.txt",
        new TextEncoder().encode(listFile.join("\n")),
      );
      await ffmpeg.exec([
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        "list.txt",
        "-c",
        "copy",
        "output.mp4",
      ]);
      const data = await ffmpeg.readFile("output.mp4");
      const url = URL.createObjectURL(
        new Blob([data as Uint8Array], { type: "video/mp4" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `${story.title || "storybook"}.mp4`;
      a.click();
    } catch (err: any) {
      alert(err.message || "Failed to export video");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main
      style={{ maxWidth: 960, margin: "40px auto", padding: "0 16px" }}
    >
      <h1>AI Storybook</h1>
      <p>
        Enter a prompt below and generate a ten‑page story with AI images and
        narration.  You can save your favourite stories and revisit them
        later, re‑roll individual pages, and export to PDF or MP4.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g., A gentle fantasy about a girl who finds a door to a starlit library…"
          style={{ flex: 1, padding: 12 }}
          disabled={busy}
        />
        <button onClick={generateStory} disabled={busy || !prompt}>
          Generate
        </button>
      </div>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {story && (
        <>
          <div
            style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}
          >
            <button onClick={saveStory}>Save Story</button>
            <button onClick={downloadPDF} disabled={busy}>
              Download PDF
            </button>
            <button onClick={downloadVideo} disabled={busy}>
              Export Video
            </button>
          </div>
          <div style={{ marginTop: 16 }}>
            <label>
              Hold time (s):
              <input
                type="number"
                min={1}
                step={0.5}
                value={holdTime}
                onChange={(e) => setHoldTime(Number(e.target.value))}
                style={{ width: 60, marginLeft: 4 }}
              />
            </label>
            <label style={{ marginLeft: 16 }}>
              Fade time (s):
              <input
                type="number"
                min={0}
                step={0.1}
                value={fadeTime}
                onChange={(e) => setFadeTime(Number(e.target.value))}
                style={{ width: 60, marginLeft: 4 }}
              />
            </label>
          </div>
          <h2 style={{ marginTop: 24 }}>{story.title}</h2>
          <div ref={bookRef} id="book" style={{ display: "grid", gap: 16 }}>
            {story.pages.map((p, i) => (
              <div
                key={i}
                className="story-page"
                style={{
                  border: "1px solid #ddd",
                  padding: 16,
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 16,
                  background: "#fff",
                }}
              >
                <div>
                  {p.imageUrl ? (
                    <img
                      src={p.imageUrl}
                      alt={`Page ${i + 1}`}
                      style={{ width: "100%", borderRadius: 8 }}
                    />
                  ) : (
                    <em>Rendering image…</em>
                  )}
                  <div style={{ marginTop: 8 }}>
                    <button
                      onClick={() => rerollImage(i)}
                      disabled={busy}
                      style={{ marginRight: 8 }}
                    >
                      Re‑roll image
                    </button>
                    <button onClick={() => rerollText(i)} disabled={busy}>
                      Re‑roll text
                    </button>
                  </div>
                </div>
                <div
                  style={{ whiteSpace: "pre-wrap", lineHeight: 1.5, fontSize: 18 }}
                >
                  {p.text}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {Object.keys(savedStories).length > 0 && (
        <div style={{ marginTop: 16 }}>
          <label>
            Load saved story:
            <select
              onChange={(e) => loadStory(e.target.value)}
              defaultValue=""
              style={{ marginLeft: 8 }}
            >
              <option value="" disabled>
                Select…
              </option>
              {Object.keys(savedStories).map((title) => (
                <option key={title} value={title}>
                  {title}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {busy && <p style={{ marginTop: 16 }}>Working… this can take a while.</p>}
    </main>
  );
}
