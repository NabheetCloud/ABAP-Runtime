@EndUserText.label: 'Document'
define root view entity ZR_Doc as select from zdoc_a
{
  key doc_id     as DocId,
      title      as Title,
      @Semantics.largeObject: { mimeType: 'MimeType', fileName: 'FileName', contentDispositionPreference: #ATTACHMENT, acceptableMimeTypes: [ 'text/*', 'application/pdf' ] }
      attachment as Attachment,
      @Semantics.mimeType: true
      mime_type  as MimeType,
      file_name  as FileName
}
