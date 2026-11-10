@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Loan - Projection'
@Metadata.allowExtensions: true
define view entity ZC_Loan
  as projection on ZR_Loan
{
  key LoanUUID,
      BookUUID,
      _Book.Title as BookTitle,
      MemberName,
      MemberEmail,
      LoanDate,
      DueDate,
      ReturnDate,
      @Semantics.largeObject: { mimeType: 'ReceiptMimeType', fileName: 'ReceiptFileName', contentDispositionPreference: #INLINE }
      ReceiptPdf,
      @Semantics.mimeType: true
      ReceiptMimeType,
      ReceiptFileName,
      case
        when ReturnDate is not initial         then 3
        when DueDate < $session.system_date    then 1
        else 0
      end         as StatusCriticality,
      case
        when ReturnDate is not initial         then 'Returned'
        when DueDate < $session.system_date    then 'Overdue'
        else 'On Loan'
      end         as LoanStatus,
      LocalLastChangedAt,

      _Book : redirected to parent ZC_Book
}
