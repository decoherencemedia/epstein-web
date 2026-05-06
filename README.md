# Epstein Web

Static front end for [Decoherence Media](https://decoherence.media/)'s [epstein.photos](https://epstein.photos/) project. For more information, read [our guide](https://decoherence.media/we-identified-more-than-400-people-in-photos-from-the-epstein-files/).

Contains pages
- `/`: Interactive D3 network visualization
- `/people`: Shows faces and names of all identified people
- `/search`: Search photos by person name or document number
- `/explore`: Groups similar photos together (UMAP dimensionality reduction of image embeddings)
- `/about`: Describes methodology, content policy, and other details

This repo is meant to sit next to [`epstein-api`](https://github.com/decoherencemedia/epstein-api) and [`epstein-pipeline`](https://github.com/decoherencemedia/epstein-pipeline). The pipeline writes graph JSON data files into `viz_data/` folder; the site build copies that tree into `dist/` along with assembled HTML, CSS, and JS.

```text
epstein-pipeline/     # produces viz_data/, atlas, etc.
epstein-api/
epstein-web/          # this repo
    site/             # partials, page bodies, build script
    dist/             # build output (gitignored)
    viz_data/         # dataset and JSON files from the pipeline
```

## Build

The build script (`./site/build.sh`) creates the static site. The primary pages (home, people, search, etc.) are assembled from shared pieces: (e.g. navigation, head, footers), plus the route-specific HTML under `site/`, and shared CSS and JavaScript. Contents of `viz_data/` (generated from running the pipeline) are copied over. The build also downloads several third-party scripts used by search, so visitors aren't depending on them at request time, and they never need to get fetched more than once.

To improve performance and SEO, static search result pages for all (sorted) length 1, 2, and 3 combinations of person_ids are generated with the `scripts/generate_static_search_pages.py` script, along with an updated sitemap. That script is called by the command `npm run build`.

Building the site with a one liner (from the `dist/` folder)
```bash
cd ../ && bash site/build.sh && cd - && python3 -m http.server
```


## Cloudflare

The Cloudflare worker ensures dynamic search result pages are served correctly, and populates the og-image URL.


## TODO

- add ability to search by uploaded face (buffalo_l + vector db)
