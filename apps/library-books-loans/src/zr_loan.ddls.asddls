@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Loan'
define view entity ZR_Loan
  as select from zloan_a
  association to parent ZR_Book as _Book on $projection.BookUUID = _Book.BookUUID
{
  key loan_uuid             as LoanUUID,
      parent_uuid           as BookUUID,
      member_name           as MemberName,
      member_email          as MemberEmail,
      loan_date             as LoanDate,
      due_date              as DueDate,
      return_date           as ReturnDate,
      @Semantics.largeObject: { mimeType: 'ReceiptMimeType', fileName: 'ReceiptFileName', contentDispositionPreference: #INLINE }
      receipt_pdf           as ReceiptPdf,
      @Semantics.mimeType: true
      receipt_mimetype      as ReceiptMimeType,
      receipt_filename      as ReceiptFileName,
      @Semantics.systemDateTime.localInstanceLastChangedAt: true
      local_last_changed_at as LocalLastChangedAt,

      _Book
}
