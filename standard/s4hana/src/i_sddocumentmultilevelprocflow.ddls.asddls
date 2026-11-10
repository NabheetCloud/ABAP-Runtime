@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'SD Document Multi-Level Process Flow'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_SDDocumentMultiLevelProcFlow
  as select from vbfa
{
  key ruuid as DocRelationshipUUID,
      posnv as PrecedingDocumentItem,
      vbeln as SubsequentDocument,
      posnn as SubsequentDocumentItem,
      vbtyp_n as SubsequentDocumentCategory,
      vbtyp_v as PrecedingDocumentCategory,
      rfmng as QuantityInBaseUnit,
      meins as BaseUnit,
      rfwrt as NetAmount,
      erdat as CreationDate,
      bwart as GoodsMovementType,
      vbelv as PrecedingDocument,
      erzet as CreationTime,
      waers as Currency
}
