# Arc icon motion references

Inspected on 2026-10-28. These are historical macOS Arc recordings from July 2023, not a claim about current Windows Arc behavior.

- `arc/motion/library-hover.gif`: local development reference, original 1080 × 1053 animated capture, 287 frames at 30ms each. Published in [Bay's Arc review](https://sspai.com/post/81386), under the View Library hover example. [Original media](https://cdnfile.sspai.com/2023/07/22/article/631bb44578f742e51c39f128118b489e?imageView2/2/w/1120/q/90/interlace/1/ignore-error/1). The recording shows a stationary storage box with a star, circle and triangle above it. Around 1.0–1.6 seconds, the pointer enters and the contents lift and rotate independently. The pointer returns several times later in the clip.
- [Hover animation footage](https://www.bilibili.com/video/BV17p4y157FS/): the same author's 14.266-second clip. Inspected as muted, paused video frames. Shows the top controls, sidebar toggle and site-controls hover states. The served 369 × 360 video is too small to establish exact easing parameters for every icon. No claim of a frame-exact match is made for navigation controls.

The experimental hover animations and replacement Library artwork were reverted at the user's request. The original outline icons, gift-shaped Library button and original press/download-arrival feedback are restored. These recordings remain historical research references only.

The media remains a development-only reference, excluded from installer packages with the rest of `dev/`. Credit belongs to the original publisher.
