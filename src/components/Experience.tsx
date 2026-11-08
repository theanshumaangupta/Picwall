"use client";

import { useState } from "react";
import { playTick, setSoundEnabled } from "@/lib/sound";
import { Home } from "./home/Home";
import { IntroLoader } from "./intro/IntroLoader";

export function Experience() {
  const [entered, setEntered] = useState(false);
  const [loaderGone, setLoaderGone] = useState(false);
  const [sound, setSound] = useState(true);

  return (
    <>
      {/* The home page sits under the loader from the start so its images load meanwhile. */}
      <Home
        entered={entered}
        sound={sound}
        onToggleSound={() => {
          const next = !sound;
          setSound(next);
          setSoundEnabled(next);
          playTick();
        }}
      />

      {!loaderGone && (
        <IntroLoader
          onEnter={(withSound) => {
            setSound(withSound);
            setSoundEnabled(withSound);
            setEntered(true);
          }}
          onDone={() => setLoaderGone(true)}
        />
      )}
    </>
  );
}
