@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Change Document'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_ChangeDocument
  as select from cdhdr
{
  key objectclas as ChangeDocObjectClass,
  key objectid as ChangeDocObject,
  key changenr as ChangeDocument,
      username as CreatedByUser,
      udate as CreationDate,
      utime as CreationTime,
      tcode as TransactionCode
}
