"use client";

/**
 * CuratorStrip — founder/curator trust accent for the Reserve LP.
 *
 * WHERE: Placed directly under <ReviewsBlock /> ("Taken care of." section)
 *        and above the final "See your edit before you commit." CTA.
 *
 * WHY: Reserve is a $250 blind first purchase. The reviews above say
 *      "Jack the COO personally resolved it" — putting the founder strip
 *      immediately below it lets a reader connect the operator they just
 *      heard praised with the operator behind the company. The credibility
 *      angle is "two capable, obsessive golfers" — not "two finance guys
 *      chasing margin."
 *
 * SSR: This component is a server component. Only the video lightbox
 *      (CuratorVideoModal) is a client island. The headline, copy, and
 *      avatars are in the initial server-rendered HTML. The primary CTA
 *      (quiz launcher) lives in a separate section below this one — this
 *      strip is intentionally CTA-free so it reads as warmth, not pitch.
 *
 * AVATARS: Stored at /public/founders/{drew,jack}.webp. Built so swapping
 *          in real photographer headshots later is trivial — change the
 *          `src` prop on Avatar. Current images are AI-generated CARTOON/
 *          illustrated placeholders (clearly stylized, not photoreal) so
 *          there's no risk of a reader mistaking them for actual photos
 *          of the founders before real portraits are commissioned.
 */

import Image from "next/image";
import { CuratorVideoModal } from "./CuratorVideoModal";

const VIDEO_ID = "3rFZMFQWuDU";

export function CuratorStrip() {
  return (
    <section className="bg-bone py-16 sm:py-24">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="mb-10 text-center sm:mb-14">
          <div className="mb-2 text-[11px] uppercase tracking-[0.28em] text-ember/80">
            Who&rsquo;s behind Reserve
          </div>
          <h2 className="font-serif text-3xl leading-[1.1] text-forest sm:text-4xl">
            Built by two guys who build things&nbsp;&mdash; and golf too much.
          </h2>
        </div>

        {/* Two-column on desktop, stacked on mobile. */}
        <div className="grid grid-cols-1 gap-10 sm:gap-12 md:grid-cols-2">
          <FounderCard
            name="Drew"
            avatarSrc="/founders/drew.webp"
            avatarAlt="Illustrated portrait of Drew, Reserve co-curator — placeholder cartoon avatar."
            bio={
              <>
                A venture investor who spent his career spotting what&rsquo;s
                worth building. Now he aims the same eye at what&rsquo;s
                actually worth wearing. 12 handicap, 20 years playing &mdash;
                the friend everyone texts before they buy anything for their
                bag.
              </>
            }
          />
          <FounderCard
            name="Jack"
            avatarSrc="/founders/jack.webp"
            avatarAlt="Illustrated portrait of Jack, Reserve co-curator and operations lead — placeholder cartoon avatar."
            bio={
              <>
                Ran large-scale digital operations, so every Reserve ships
                right, fits right, and gets handled when it doesn&rsquo;t. 7
                handicap, 20 years playing &mdash; the one who reads the spec
                sheet before he buys.
              </>
            }
          />
        </div>

        {/* Closing line — first person, spans full width beneath both cards. */}
        <p className="mx-auto mt-10 max-w-3xl text-center font-serif text-lg leading-snug text-forest/85 sm:mt-14 sm:text-xl">
          We&rsquo;ve been the guys our friends text for gear advice for
          years. Reserve is just us doing it on purpose.
        </p>

        {/* Understated video invitation. Opens modal — does NOT navigate to YouTube. */}
        <div className="mt-8 flex justify-center sm:mt-10">
          <CuratorVideoModal videoId={VIDEO_ID} />
        </div>
      </div>
    </section>
  );
}

function FounderCard({
  name,
  avatarSrc,
  avatarAlt,
  bio,
}: {
  name: string;
  avatarSrc: string;
  avatarAlt: string;
  bio: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center text-center sm:flex-row sm:items-start sm:text-left sm:gap-6">
      <div className="relative h-24 w-24 flex-shrink-0 overflow-hidden rounded-full border border-forest/15 shadow-sm sm:h-28 sm:w-28">
        <Image
          src={avatarSrc}
          alt={avatarAlt}
          fill
          sizes="(min-width: 640px) 112px, 96px"
          className="object-cover"
        />
      </div>
      <div className="mt-4 sm:mt-1">
        <div className="font-serif text-2xl text-forest">{name}</div>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-charcoal/80 sm:text-base">
          {bio}
        </p>
      </div>
    </div>
  );
}
