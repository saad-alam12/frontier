# vendor

`sharp-stub/` is a stand-in for the `sharp` image library, which `@huggingface/transformers` lists as a dependency for its image models. Frontier embeds text only and never calls it. The real package ships prebuilt libvips binaries under LGPL-3.0, which the licence rule in `CLAUDE.md` does not allow, so `package.json` installs this stand-in instead (`dependencies.sharp` plus an override, so the library gets the same one).

`sharp-0.35.5.tgz` is the stand-in packed (`npm pack ./sharp-stub`); it is what npm installs. After changing `sharp-stub/`, pack it again and run `npm install`.

`npm run check:licenses` fails if a non-permissive licence comes back.
