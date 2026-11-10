@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Loan Receipt - Form Data'
@ObjectModel.supportedCapabilities: [ #OUTPUT_FORM_DATA_PROVIDER ]
@Metadata.ignorePropagatedAnnotations: true
define root view entity ZI_LoanReceipt
  as select from zloan_a
  association [1..1] to ZR_Book as _Book on $projection.BookUUID = _Book.BookUUID
{
  key loan_uuid    as LoanUUID,
      parent_uuid  as BookUUID,
      _Book.Title  as BookTitle,
      _Book.Author as Author,
      _Book.ISBN   as ISBN,
      _Book.Genre  as Genre,
      member_name  as MemberName,
      member_email as MemberEmail,
      loan_date    as LoanDate,
      due_date     as DueDate,
      return_date  as ReturnDate,
      // the date the overdue days are counted to: the return date, or today while the book is out
      case
        when return_date is initial then $session.system_date
        else return_date
      end          as ReferenceDate
}
