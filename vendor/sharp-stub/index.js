// Stand-in for the `sharp` image library, which @huggingface/transformers imports for its image
// models. Frontier only embeds text, so nothing here is ever called. The real package ships prebuilt
// libvips binaries under LGPL-3.0, which the project's licence rule (CLAUDE.md) does not allow.
export default function sharp() {
  throw new Error('Image processing is not part of Frontier: the sharp library is not installed.');
}
