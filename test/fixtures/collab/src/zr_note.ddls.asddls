@EndUserText.label: 'Note'
define root view entity ZR_Note as select from znote_a
{
  key note_id    as NoteId,
      text       as Text,
      @Semantics.systemDateTime.localInstanceLastChangedAt: true
      changed_at as ChangedAt
}
