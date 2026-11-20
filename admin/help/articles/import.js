// Help article: see admin/help/topics.js. Markdown, as admin/help/markdown.js reads it.
export default String.raw`
**Import** (owners only) brings in titles and pull lists from spreadsheets. Most shops rarely need it: the catalog fills **Titles** by itself.

![Import → Import Files](import-files)

## Import Files

For titles the catalog doesn't carry, drop in a Lunar, PRH or Funko sheet, or any spreadsheet with a Title column. You see what will change before anything is saved.

## Pull Lists

For a shop moving to Pullwise: bring in every customer and the series they take, from one spreadsheet, once.

1. **Get the sheet ready.** **Download sample CSV** shows the columns. One row per customer and title, or all their titles in one cell, both work.
2. **Check the columns** the import guessed.
3. **Match titles** to series. **Needs a look** lines show the closest match; pick one or skip. Choices are remembered for next time.
4. **Check the customers.** Each is marked **New** or **In Pullwise** (same email or phone).
5. **Save.** Nothing is saved until you press Save, and saving sends no email.

## Always Skip

Publishers, series and words to leave out of every import, for things you never carry. Incentive and "N COPY" covers are always skipped.

![Import → Always Skip](import-skip)

## Left Out (master catalog)

On the master catalog, **Left Out** lists what the daily PRH and Lunar imports didn't take, and why: ratio covers, store and convention exclusives, retailer bundles, titles on the Always Skip list, and titles already in from the other distributor (same UPC or ISBN). Each run replaces its own list. Search by title or code to find out why a book isn't in the catalog, and **Export CSV** for a spreadsheet.

**Recent Runs** keeps a record of each import.
`;
