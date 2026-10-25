# Credits (design proposal v3)

Everything third-party in this prototype is listed here. All of it is **sample material** that stands in for the client's own photography and video, and must be replaced by it. None of it is Urban Ìbílé product.

## Sample video clips (Pexels)

Licence: [Pexels License](https://www.pexels.com/license/): free for commercial use, no attribution required (given here anyway). The clips are compressed and cropped for the web (`scripts/build-media.mjs`); no logos or text appear in them. The people shown are stock-footage models; nobody is named or identified in the prototype.

| Clip | Creator | Source page | Used for |
|---|---|---|---|
| Model in a black dress walking toward the camera | cottonbro studio | https://www.pexels.com/video/a-female-model-walking-in-a-black-dress-9510022/ | `hero-wide`, `p02`, `p09` |
| Model in a floral dress on a runway (portrait) | cottonbro studio | https://www.pexels.com/video/fashion-model-walking-in-the-runway-9512048/ | `hero-tall`, `p01`, `p10` |
| Woman walking down a runway | cottonbro studio | https://www.pexels.com/video/a-woman-walking-down-the-runway-9512045/ | `p07` |
| Two men in a green blazer and a floral shirt | cottonbro studio | https://www.pexels.com/video/man-in-green-suit-with-pink-flower-9953125/ | `p03`, `p04`, `p08` |
| Man fitting a suit | Tima Miroshnichenko | https://www.pexels.com/video/man-fitting-suit-6764969/ | `p05` |
| Man buttoning his jacket while walking | vickie photography (@vickievj) | https://www.pexels.com/video/a-man-buttoning-his-jacket-while-walking-5345978/ | `p06` |
| Woman holding a measuring tape | Ron Lach | https://www.pexels.com/video/woman-holding-a-measuring-tape-7778408/ | `band` |
| Mannequin with a tape measure | Pavel Danilyuk | https://www.pexels.com/video/a-mannequin-with-a-tape-measure-around-it-6459952/ | `fit-intro` |

The original files are not committed (they are large): `node scripts/build-media.mjs` downloads them into `.cache/` from the addresses in `scripts/media-manifest.json`.

## Brand assets (the client's, used unmodified)

- Wordmark logos and the icon: `assets/brand/` (from the client's logo files).
- Drafting Mono (SIL OFL 1.1; licence next to the files) and Inter (SIL OFL 1.1): subsetted WOFF2 in `assets/fonts/`.

## Not included

The client's own clips go in `prototype-media/` (not committed; see the README). A clip there that has been given a name from the manifest replaces the stock one. Add its licence to this file when it is used.
