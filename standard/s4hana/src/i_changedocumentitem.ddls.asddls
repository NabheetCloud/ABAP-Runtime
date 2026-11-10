@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Change Document Item'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_ChangeDocumentItem
  as select from cdpos
{
  key objectclas as ChangeDocObjectClass,
  key objectid as ChangeDocObject,
  key changenr as ChangeDocument,
  key tabname as DatabaseTable,
  key tabkey as ChangeDocTableKey,
  key fname as ChangeDocDatabaseTableField,
  key chngind as ChangeDocItemChangeType,
      value_old as ChangeDocPreviousFieldValue,
      value_new as ChangeDocNewFieldValue
}
