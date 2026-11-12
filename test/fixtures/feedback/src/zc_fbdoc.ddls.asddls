@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Feedback document (projection)'
define view entity ZC_FbDoc as select from ZI_FbDoc
{
  key DocId,
      Reference,
      DocDate
}
