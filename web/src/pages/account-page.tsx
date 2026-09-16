import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { toast } from "sonner";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { getAccountSettings, setEmailNotificationsEnabled } from "@/api/account";
import { queryKeys } from "@/api/query-keys";

export function AccountPage() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: queryKeys.account(),
    queryFn: getAccountSettings,
  });
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (settingsQuery.data) setEnabled(settingsQuery.data.emailNotificationsEnabled);
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (next: boolean) => setEmailNotificationsEnabled(next),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.account() });
      toast.success("Preference saved");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to save preference"),
  });

  const settings = settingsQuery.data;
  const dirty = settings ? enabled !== settings.emailNotificationsEnabled : false;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Helmet>
        <title>Account settings</title>
      </Helmet>
      <SiteHeader />
      <main className="content-container flex flex-1 flex-col gap-xl py-xxl">
        <header className="flex flex-col gap-xxs">
          <h1 className="font-display text-display-md text-ink">Account settings</h1>
          <p className="text-body-md text-muted-foreground">
            Manage your account details and notification preferences.
          </p>
        </header>
        <Separator />
        {settingsQuery.isLoading ? (
          <Skeleton className="h-[200px] w-full max-w-lg rounded-md" />
        ) : settingsQuery.isError ? (
          <p className="text-body-md text-destructive">{settingsQuery.error.message}</p>
        ) : (
          <div className="flex max-w-lg flex-col gap-lg">
            <Card>
              <CardHeader>
                <CardTitle>Profile</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-sm">
                <div className="flex flex-col gap-xxs">
                  <span className="text-caption text-muted-foreground">Name</span>
                  <span className="text-body-md text-ink">{settings?.name}</span>
                </div>
                <div className="flex flex-col gap-xxs">
                  <span className="text-caption text-muted-foreground">Email</span>
                  <span className="text-body-md text-ink">{settings?.email}</span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Email notifications</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-md">
                <label className="flex items-center gap-sm text-body-md text-body" htmlFor="email-notifications">
                  <Checkbox
                    id="email-notifications"
                    checked={enabled}
                    onCheckedChange={(checked) => setEnabled(checked === true)}
                  />
                  <Label htmlFor="email-notifications" className="cursor-pointer">
                    Send me email notifications
                  </Label>
                </label>
                <Button
                  size="sm"
                  className="self-start"
                  disabled={!dirty || saveMutation.isPending}
                  onClick={() => saveMutation.mutate(enabled)}
                >
                  {saveMutation.isPending ? "Saving..." : "Save preference"}
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
