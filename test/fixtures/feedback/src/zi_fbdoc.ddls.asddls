@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Feedback document'
define view entity ZI_FbDoc as select from zfbdoc_a
{
  key doc_id    as DocId,
      reference as Reference,
      doc_date  as DocDate
}
