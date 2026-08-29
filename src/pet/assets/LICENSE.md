# Animation asset — source and license

> **This file is a distribution obligation, not optional documentation.**
> The Lottie Simple License requires that *"any display, publication, performance, or
> distribution of Files must contain (and be subject to) the same terms and conditions
> of this license."* `cat.json` is distributed with this repository, so the license text
> must travel alongside it. Deleting this file would put the project out of compliance.

## Asset

| | |
|---|---|
| File | `src/pet/assets/cat.json` |
| Animation | Kitty Cat Error 404 (the `nm` field inside the Lottie file reads "No Connection Animation") |
| Author | **Sepehr Radfar** |
| Source | https://lottiefiles.com/free-animation/kitty-cat-error-404-fvL7jDNahz |
| License | Lottie Simple License (FL 9.13.21) |
| Verified | 2026-08-28 |

## How this project uses it

- **The original file is unmodified.** `cat.json` is byte-for-byte as downloaded from
  LottieFiles. The `CROPPED_VIEW_BOX` in `cat.tsx` adjusts an attribute on the *rendered
  SVG node at runtime*; it is never written back to the file. On that basis this is not a
  derivative work as defined by the license.
- Usage: the desk-pet character in the browser extension's side panel, across its three
  states (companion / observing / check-in).
- Those states are conveyed by the surrounding anchor badge and speech-bubble colours
  (see `cat.css`), not by altering the animation itself.

## Attribution

Attribution is **not required** under this license — *"Use of Files without attributing
the creator(s) of the Files is permitted under this license, though attribution is
strongly encouraged."* We attribute anyway: it costs nothing and the license explicitly
encourages it.

> Cat animation by **Sepehr Radfar** on
> [LottieFiles](https://lottiefiles.com/free-animation/kitty-cat-error-404-fvL7jDNahz),
> used under the Lottie Simple License.

**Note the follow-on clause:** *"If attributions are included, such attributions should be
visible to the end user."* Because we chose to attribute, that clause now applies — the
credit has to be visible to end users, not merely present in a repository file.
**TODO (J12):** surface this credit in the README and, if one is added, the extension's
about/settings screen.

## A restriction that does not apply to us

> *"This license does not include the right to collect or compile Files from LottieFiles
> to replicate or develop a similar or competing service."*

We use a single animation inside our own product; we are not building an animation
library or a competing asset service.

---

## Lottie Simple License (FL 9.13.21) — full text

```
Lottie Simple License (FL 9.13.21)
Copyright © 2021 Design Barn Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy of the
public animation files available for download at the LottieFiles site ("Files") to
download, reproduce, modify, publish, distribute, publicly display, and publicly
digitally perform such Files, including for commercial purposes, provided that any
display, publication, performance, or distribution of Files must contain (and be
subject to) the same terms and conditions of this license. Modifications to Files are
deemed derivative works and must also be expressly distributed under the same terms and
conditions of this license. You may not purport to impose any additional or different
terms or conditions on, or apply any technical measures that restrict exercise of, the
rights granted under this license. This license does not include the right to collect
or compile Files from LottieFiles to replicate or develop a similar or competing service.

Use of Files without attributing the creator(s) of the Files is permitted under this
license, though attribution is strongly encouraged. If attributions are included, such
attributions should be visible to the end user.

FILES ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE
AND NONINFRINGEMENT. EXCEPT TO THE EXTENT REQUIRED BY APPLICABLE LAW, IN NO EVENT WILL
THE CREATOR(S) OF FILES OR DESIGN BARN, INC. BE LIABLE ON ANY LEGAL THEORY FOR ANY
SPECIAL, INCIDENTAL, CONSEQUENTIAL, PUNITIVE, OR EXEMPLARY DAMAGES ARISING OUT OF THIS
LICENSE OR THE USE OF SUCH FILES.
```