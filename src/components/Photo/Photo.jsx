import "./Photo.css";

/**
 * A campus photo, in the smallest file that will still look right.
 *
 * `<picture>` rather than a bare `<img srcset>` on purpose: srcset entries are
 * not type-checked, so a browser that understands srcset but not WebP — Safari
 * 13 and older — would happily pick a WebP and show a broken image. The
 * `<source>` is what lets it fall through to the JPEG instead.
 *
 * `sizes` is required, not optional. Without it the browser assumes the photo
 * fills the viewport and takes the largest file, which undoes the whole point.
 * Pass one of the values from PHOTO_SIZES.
 */
export default function Photo({ photo, sizes, alt = "", className = "", ...rest }) {
  if (!photo) return null;
  return (
    <picture className="photo">
      <source type="image/webp" srcSet={photo.webpSrcSet} sizes={sizes} />
      <img src={photo.jpg} alt={alt} sizes={sizes} className={className} {...rest} />
    </picture>
  );
}
