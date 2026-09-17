"""Turn a Word document into a knowledge article.

The alternative was to store the .docx and render it in a viewer. That is worse
for the one thing Knowledge exists to do: search only sees text in the body, so
a runbook trapped inside a binary is a runbook nobody finds in six months. It
also cannot be corrected - and a vendor's install guide is always half wrong by
the second time you follow it.

So the document is converted to markdown and the original is kept alongside as
an attachment, which preserves the formatting nobody wants to lose and the
provenance of "this came from the vendor's own guide".

Conversion is mammoth for .docx to HTML, because it maps Word's *semantic*
styles - Heading 1, List Bullet - rather than trying to reproduce fonts, and
markdownify for HTML to markdown.
"""
import io
import re
from typing import Callable, Dict, List, Optional

import mammoth
from markdownify import markdownify

# Word has no built-in "code" style, but people invent one. Mapping the common
# names costs nothing and saves a runbook's commands from arriving as prose.
STYLE_MAP = """
p[style-name='Code'] => pre:separator('\\n')
p[style-name='Code Block'] => pre:separator('\\n')
p[style-name='Source Code'] => pre:separator('\\n')
p[style-name='Quote'] => blockquote > p:fresh
p[style-name='Intense Quote'] => blockquote > p:fresh
r[style-name='Code Char'] => code
r[style-name='Verbatim Char'] => code
"""

ImageSaver = Callable[[str, bytes, int], Optional[str]]


def promote_empty_table_header(markdown: str) -> str:
    """Give a Word table its header row back.

    Word's default table styles carry no header markup, so mammoth emits plain
    `<td>` for every row and markdownify then invents an empty header - leaving
    a table whose first row is blank and whose real header sits in the body.
    Every table pasted out of a vendor document hits this.
    """
    lines = markdown.split("\n")
    out: List[str] = []
    i = 0
    while i < len(lines):
        header, sep = lines[i], lines[i + 1] if i + 1 < len(lines) else ""
        blank_header = (
            header.startswith("|")
            and re.fullmatch(r"\|[\s|]*\|", header) is not None
            and re.fullmatch(r"\|[\s\-:|]*\|", sep) is not None
        )
        if blank_header and i + 2 < len(lines) and lines[i + 2].startswith("|"):
            out.append(lines[i + 2])   # the real header, promoted
            out.append(sep)
            i += 3
            continue
        out.append(header)
        i += 1
    return "\n".join(out)


def tidy(markdown: str) -> str:
    """Word leaves debris. Remove the parts that only add noise."""
    # Word writes a paragraph for every press of Enter, which becomes a run of
    # blank lines. Markdown needs one.
    markdown = re.sub(r"\n{3,}", "\n\n", markdown)
    # Non-breaking spaces come through as \xa0 and look like ordinary spaces
    # until something fails to match them.
    markdown = markdown.replace("\xa0", " ")
    markdown = "\n".join(line.rstrip() for line in markdown.split("\n"))
    return markdown.strip() + "\n"


def strip_leading_heading(markdown: str, heading: str) -> str:
    """Remove the heading that became the article's title.

    Otherwise every imported document opens with its own name printed twice -
    once as the article title and again as the first line of the body.
    """
    lines = markdown.split("\n")
    for i, line in enumerate(lines[:5]):
        if not line.strip():
            continue
        m = re.match(r"^#{1,3}\s+(.+?)\s*$", line)
        if m and m.group(1) == heading:
            rest = lines[i + 1:]
            while rest and not rest[0].strip():
                rest.pop(0)
            return "\n".join(lines[:i] + rest)
        break      # only if it is the *first* thing in the document
    return markdown


def first_heading(markdown: str) -> Optional[str]:
    for line in markdown.split("\n"):
        m = re.match(r"^#{1,3}\s+(.+?)\s*$", line)
        if m:
            return m.group(1)[:255]
    return None


def convert(data: bytes, save_image: Optional[ImageSaver] = None) -> Dict:
    """Convert one .docx. `save_image` returns the URL to reference it by.

    The saver is injected rather than imported so this module knows nothing
    about attachments, and so the conversion can be tested without a database.
    Returning None from it drops the image rather than failing the import - a
    document is still worth having without its screenshots.
    """
    saved: List[Dict] = []

    def handler(image):
        with image.open() as f:
            blob = f.read()
        index = len(saved) + 1
        url = save_image(image.content_type or "image/png", blob, index) if save_image else None
        saved.append({
            "index": index,
            "content_type": image.content_type,
            "bytes": len(blob),
            "url": url,
        })
        if not url:
            # No src at all: DOMPurify would strip a broken one anyway, and an
            # empty <img> renders as a broken-image icon in the middle of a
            # runbook.
            return {}
        return {"src": url, "alt": image.alt_text or f"Figure {index}"}

    result = mammoth.convert_to_html(
        io.BytesIO(data),
        style_map=STYLE_MAP,
        convert_image=mammoth.images.img_element(handler),
    )

    markdown = markdownify(result.value, heading_style="ATX", bullets="-")
    markdown = promote_empty_table_header(markdown)
    markdown = tidy(markdown)

    return {
        "markdown": markdown,
        "title": first_heading(markdown),
        "images": saved,
        # mammoth reports unmapped styles here. Worth surfacing: it is the
        # difference between "the import lost my code blocks" and knowing why.
        "warnings": [m.message for m in result.messages],
    }
